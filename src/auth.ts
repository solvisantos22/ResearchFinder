import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth from "next-auth";

import { authConfig } from "@/auth.config";
import { prisma } from "@/lib/db";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" }
});
