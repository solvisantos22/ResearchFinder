import React from "react";
import { headers } from "next/headers";

import { WorkerSetupContent } from "@/components/WorkerSetupContent";
import { registerWorker } from "@/app/workers/actions";
import { requireCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

function resolveAppUrl(headerList: Headers) {
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  if (configured) return configured;

  const host = headerList.get("x-forwarded-host") || headerList.get("host") || "localhost:3000";
  const protocol = headerList.get("x-forwarded-proto") || "http";
  return `${protocol}://${host}`;
}

export default async function WorkersPage() {
  const currentUser = await requireCurrentUser();
  const [headerList, workers] = await Promise.all([
    headers(),
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

  return (
    <WorkerSetupContent
      appUrl={resolveAppUrl(headerList)}
      workers={workers}
      registrationAction={registerWorker}
      registrationResult={null}
    />
  );
}
