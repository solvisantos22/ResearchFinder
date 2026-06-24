import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

import { isAllowedGoogleEmail } from "@/lib/auth/allowed-emails";

function googleProvider() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  return Google(clientId && clientSecret ? { clientId, clientSecret } : {});
}

export const authConfig = {
  session: { strategy: "jwt" },
  providers: [googleProvider()],
  callbacks: {
    authorized({ auth }) {
      return isAllowedGoogleEmail(auth?.user?.email);
    },
    async signIn({ user }) {
      return isAllowedGoogleEmail(user.email);
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    }
  }
} satisfies NextAuthConfig;
