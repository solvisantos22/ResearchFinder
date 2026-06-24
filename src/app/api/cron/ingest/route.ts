import { NextRequest, NextResponse } from "next/server";
import { isAllowedGoogleEmail } from "@/lib/auth/allowed-emails";
import { prisma } from "@/lib/db";
import { buildDailyInboxForUser } from "@/lib/inbox/service";
import { isAuthorizedCronRequest } from "./auth";

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || !isAuthorizedCronRequest(request.headers.get("authorization"), cronSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const users = await prisma.user.findMany({
    where: { profile: { isNot: null } },
    select: { id: true, email: true }
  });
  const allowedUsers = users.filter((user) => isAllowedGoogleEmail(user.email));
  const inboxDate = todayIsoDate();
  const results = [];

  for (const user of allowedUsers) {
    const items = await buildDailyInboxForUser(user.id, inboxDate);
    results.push({ userId: user.id, count: items.length });
  }

  return NextResponse.json({ inboxDate, results });
}
