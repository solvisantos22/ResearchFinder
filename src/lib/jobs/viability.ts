import { canDispatchIdeaForProfile } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { validateDispatchSettingsWithDefaults } from "@/lib/dispatch/service";

export async function createV2ViabilityJob(input: {
  currentUserId: string;
  generatedIdeaId: string;
  sprintDepth?: string;
  autonomyLevel?: string;
}) {
  const settings = validateDispatchSettingsWithDefaults(input);
  const idea = await prisma.generatedIdea.findUnique({
    where: { id: input.generatedIdeaId },
    select: { id: true, userId: true }
  });

  if (
    !idea ||
    !canDispatchIdeaForProfile({
      currentUserId: input.currentUserId,
      generatedForUserId: idea.userId
    })
  ) {
    throw new Error("Generated idea is not available for dispatch by this user");
  }

  return prisma.viabilityJob.create({
    data: {
      userId: input.currentUserId,
      ideaId: null,
      generatedIdeaId: idea.id,
      sprintDepth: settings.sprintDepth,
      autonomyLevel: settings.autonomyLevel,
      status: "queued"
    }
  });
}
