import { notFound, redirect } from "next/navigation";

import { prisma } from "@/lib/db";
import { getActivePrivateUserId, isPrivateAccessConfigured } from "@/lib/private-access-server";

export async function requireCurrentUser() {
  const userId = isPrivateAccessConfigured() ? await getActivePrivateUserId() : "demo-solvi";

  if (!userId) {
    redirect("/");
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) {
    notFound();
  }

  return user;
}
