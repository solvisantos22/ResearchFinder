import { NextResponse } from "next/server";
import { findAllowedLauncherByToken } from "@/lib/auth/launcher-token";
import { readBearerToken } from "@/lib/jobs/worker-auth";
import { prisma } from "@/lib/db";
import { getDesiredLanes } from "@/lib/launcher/desired-state";
import { consumeLauncherRestart } from "@/lib/launcher/restart";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const token = readBearerToken(request);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const launcher = await findAllowedLauncherByToken(token);
  if (!launcher) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const restartRequested = await consumeLauncherRestart(launcher.id);
  await prisma.launcherRegistration.update({ where: { id: launcher.id }, data: { lastSeenAt: new Date() } });
  const desired = await getDesiredLanes(launcher.userId);
  return NextResponse.json({ ...desired, restartRequested });
}
