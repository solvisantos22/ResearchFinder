import type { Route } from "next";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAllowedGoogleEmail } from "@/lib/auth/allowed-emails";

export async function requireCurrentUser() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/api/auth/signin" as Route);
  }

  if (!isAllowedGoogleEmail(session.user.email)) {
    redirect("/api/auth/signin" as Route);
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id }
  });

  if (!user) {
    notFound();
  }

  return user;
}
