import type { Route } from "next";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export async function requireCurrentUser() {
  const session = await auth();
  if (!session?.user?.id) {
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
