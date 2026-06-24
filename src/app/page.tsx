import { redirect } from "next/navigation";

import { requireCurrentUser } from "@/lib/auth/session";
import { ensureProfileForUser } from "@/lib/profiles/service";

export default async function HomePage() {
  const currentUser = await requireCurrentUser();

  await ensureProfileForUser(currentUser.id, "ai_ml");
  redirect(`/inbox/${currentUser.id}`);
}
