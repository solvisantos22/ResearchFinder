import React from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Route } from "next";

import { requireCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { createWorkerToken, hashWorkerToken } from "@/lib/jobs/worker-auth";

const WORKER_TOKEN_COOKIE = "rf_worker_setup_token";

type WorkerStatusRow = {
  id: string;
  label: string;
  status: string;
  lastSeenAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
};

type WorkerSetupContentProps = {
  appUrl: string;
  workers: WorkerStatusRow[];
  registrationAction: () => Promise<void>;
  registrationResult?: { token: string } | null;
};

function formatDate(value: Date | null) {
  return value ? value.toISOString() : "Never";
}

function setupCommand(appUrl: string, token: string) {
  return `powershell -ExecutionPolicy Bypass -File scripts/install-worker.ps1 -AppUrl "${appUrl}" -WorkerToken "${token}"`;
}

function resolveAppUrl(headerList: Headers) {
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  if (configured) return configured;

  const host = headerList.get("x-forwarded-host") || headerList.get("host") || "localhost:3000";
  const protocol = headerList.get("x-forwarded-proto") || "http";
  return `${protocol}://${host}`;
}

export async function registerWorker() {
  "use server";

  const currentUser = await requireCurrentUser();
  const token = createWorkerToken();
  const tokenHash = await hashWorkerToken(token);

  await prisma.workerRegistration.create({
    data: {
      userId: currentUser.id,
      label: "Local Codex worker",
      tokenHash,
      status: "pending"
    }
  });

  const cookieStore = await cookies();
  cookieStore.set(WORKER_TOKEN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/workers",
    maxAge: 60
  });

  redirect("/workers?registered=1" as Route);
}

export function WorkerSetupContent({
  appUrl,
  workers,
  registrationAction,
  registrationResult
}: WorkerSetupContentProps) {
  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6">
        <p className="text-sm font-medium uppercase tracking-wide text-slate-500">
          Worker setup
        </p>
        <h1 className="text-3xl font-semibold text-slate-900">Connect my Codex worker</h1>
        <p className="mt-2 text-slate-600">
          Register a local worker, run the setup command once, then monitor status here.
        </p>
      </header>

      <section className="mb-6 rounded-lg border border-line bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">PowerShell setup command</h2>
            <p className="mt-1 text-sm text-slate-600">
              The worker token is shown only immediately after registration.
            </p>
          </div>
          <form action={registrationAction}>
            <button
              type="submit"
              className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
            >
              Create worker token
            </button>
          </form>
        </div>

        {registrationResult?.token ? (
          <pre className="mt-4 overflow-x-auto rounded-md bg-slate-950 p-4 text-sm text-slate-50">
            <code>{setupCommand(appUrl, registrationResult.token)}</code>
          </pre>
        ) : (
          <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            Register a worker to reveal the one-time setup command.
          </div>
        )}
      </section>

      <section className="rounded-lg border border-line bg-white p-5">
        <h2 className="text-xl font-semibold text-slate-900">Current worker status</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-slate-200 text-slate-500">
              <tr>
                <th className="py-2 pr-4 font-medium">Worker</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Last seen timestamp</th>
                <th className="py-2 pr-4 font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {workers.length === 0 ? (
                <tr>
                  <td className="py-4 pr-4" colSpan={4}>
                    No workers registered yet.
                  </td>
                </tr>
              ) : (
                workers.map((worker) => (
                  <tr key={worker.id}>
                    <td className="py-3 pr-4 font-medium text-slate-900">{worker.label}</td>
                    <td className="py-3 pr-4">{worker.revokedAt ? "revoked" : worker.status}</td>
                    <td className="py-3 pr-4">{formatDate(worker.lastSeenAt)}</td>
                    <td className="py-3 pr-4">{formatDate(worker.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default async function WorkersPage() {
  const currentUser = await requireCurrentUser();
  const [headerList, cookieStore, workers] = await Promise.all([
    headers(),
    cookies(),
    prisma.workerRegistration.findMany({
      where: { userId: currentUser.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        label: true,
        status: true,
        lastSeenAt: true,
        createdAt: true,
        revokedAt: true
      }
    })
  ]);
  const token = cookieStore.get(WORKER_TOKEN_COOKIE)?.value;

  return (
    <WorkerSetupContent
      appUrl={resolveAppUrl(headerList)}
      workers={workers}
      registrationAction={registerWorker}
      registrationResult={token ? { token } : null}
    />
  );
}
