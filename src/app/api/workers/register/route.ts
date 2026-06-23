import { NextResponse } from "next/server";

import { requireCurrentUser } from "@/lib/auth/session";
import { registerWorkerForUser } from "@/lib/jobs/worker-registration";

export async function POST() {
  const currentUser = await requireCurrentUser();
  const registration = await registerWorkerForUser({
    userId: currentUser.id,
    label: `Worker ${new Date().toISOString()}`
  });

  return NextResponse.json({
    workerId: registration.workerId,
    token: registration.token
  });
}
