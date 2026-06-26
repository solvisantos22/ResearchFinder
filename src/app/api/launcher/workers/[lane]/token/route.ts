import { NextResponse } from "next/server";
import { findAllowedLauncherByToken } from "@/lib/auth/launcher-token";
import { readBearerToken } from "@/lib/jobs/worker-auth";
import { provisionLaneWorkerToken } from "@/lib/launcher/desired-state";
import { LAUNCHER_LANES, type LauncherLane } from "@/lib/v2/domain";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ lane: string }> }) {
  const token = readBearerToken(request);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const launcher = await findAllowedLauncherByToken(token);
  if (!launcher) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { lane } = await params;
  if (!(LAUNCHER_LANES as readonly string[]).includes(lane)) {
    return NextResponse.json({ error: "Unknown launcher lane" }, { status: 400 });
  }

  const provisioned = await provisionLaneWorkerToken(launcher.userId, lane as LauncherLane);
  return NextResponse.json({ token: provisioned.token });
}
