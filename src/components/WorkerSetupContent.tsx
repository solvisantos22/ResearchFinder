"use client";

import React, { useActionState } from "react";

import { WorkerStatusLive } from "@/components/WorkerStatusLive";
import type { WorkerStatus } from "@/components/WorkerStatusPanel";

type WorkerStatusRow = {
  id: string;
  label: string;
  status: string;
  lastSeenAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
};

export type WorkerRegistrationActionState = { token: string } | null;

export type WorkerRegistrationAction = (
  previousState: WorkerRegistrationActionState,
  formData: FormData
) => Promise<WorkerRegistrationActionState>;

type WorkerSetupContentProps = {
  appUrl: string;
  workers: WorkerStatusRow[];
  registrationAction: WorkerRegistrationAction;
  registrationResult?: WorkerRegistrationActionState;
  initialWorkerStatus?: WorkerStatus;
  statusAction?: () => Promise<WorkerStatus>;
};

function formatDate(value: Date | null) {
  return value ? value.toISOString() : "Never";
}

function quotePowerShellLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function setupCommand(appUrl: string, token: string) {
  return `powershell -ExecutionPolicy Bypass -File scripts/install-worker.ps1 -AppUrl ${quotePowerShellLiteral(appUrl)} -WorkerToken ${quotePowerShellLiteral(token)}`;
}

export function WorkerSetupContent({
  appUrl,
  workers,
  registrationAction,
  registrationResult = null,
  initialWorkerStatus = "unknown",
  statusAction
}: WorkerSetupContentProps) {
  const [state, formAction, isPending] = useActionState(registrationAction, registrationResult);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6">
        <p className="text-sm font-medium uppercase tracking-wide text-rf-muted">
          Worker setup
        </p>
        <h1 className="text-3xl font-semibold text-rf-white">Connect my Codex worker</h1>
        <p className="mt-2 text-rf-muted">
          Register a local worker, run the setup command once, then monitor status here.
        </p>
      </header>

      <section className="mb-6 rounded-md border border-rf-border bg-rf-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-rf-white">PowerShell setup command</h2>
            <p className="mt-1 text-sm text-rf-muted">
              The worker token is shown only immediately after registration.
            </p>
          </div>
          <form action={formAction}>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-rf-violet px-4 py-2 text-sm font-semibold text-rf-white transition-colors hover:bg-rf-violetSoft disabled:cursor-not-allowed disabled:bg-rf-border"
            >
              Create worker token
            </button>
          </form>
        </div>

        {state?.token ? (
          <pre className="mt-4 overflow-x-auto rounded-md bg-rf-surface p-4 text-sm text-rf-white">
            <code>{setupCommand(appUrl, state.token)}</code>
          </pre>
        ) : (
          <div className="mt-4 rounded-md border border-rf-border bg-rf-surface p-4 text-sm text-rf-muted">
            Register a worker to reveal the one-time setup command.
          </div>
        )}
      </section>

      <section className="rounded-md border border-rf-border bg-rf-panel p-5">
        <h2 className="text-xl font-semibold text-rf-white">Current worker status</h2>
        <div className="mt-4">
          <WorkerStatusLive initialStatus={initialWorkerStatus} statusAction={statusAction} />
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-rf-border text-rf-muted">
              <tr>
                <th className="py-2 pr-4 font-medium">Worker</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Last seen timestamp</th>
                <th className="py-2 pr-4 font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rf-border text-rf-muted">
              {workers.length === 0 ? (
                <tr>
                  <td className="py-4 pr-4" colSpan={4}>
                    No workers registered yet.
                  </td>
                </tr>
              ) : (
                workers.map((worker) => (
                  <tr key={worker.id}>
                    <td className="py-3 pr-4 font-medium text-rf-white">{worker.label}</td>
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
