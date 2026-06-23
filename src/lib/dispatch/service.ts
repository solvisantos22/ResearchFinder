import {
  AUTONOMY_LEVELS,
  SPRINT_DEPTHS,
  type AutonomyLevel,
  type SprintDepth
} from "@/lib/domain";
import { canDispatchIdeaForProfile } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";

export const DEFAULT_SPRINT_DEPTH: SprintDepth = "default";
export const DEFAULT_AUTONOMY_LEVEL: AutonomyLevel = "medium";

export function validateDispatchSettings(sprintDepth: string, autonomyLevel: string) {
  if (!SPRINT_DEPTHS.includes(sprintDepth as SprintDepth)) {
    throw new Error("Invalid sprint depth");
  }

  if (!AUTONOMY_LEVELS.includes(autonomyLevel as AutonomyLevel)) {
    throw new Error("Invalid autonomy level");
  }

  return {
    sprintDepth: sprintDepth as SprintDepth,
    autonomyLevel: autonomyLevel as AutonomyLevel
  };
}

export function validateDispatchSettingsWithDefaults(input: {
  sprintDepth?: string;
  autonomyLevel?: string;
}) {
  return validateDispatchSettings(
    input.sprintDepth ?? DEFAULT_SPRINT_DEPTH,
    input.autonomyLevel ?? DEFAULT_AUTONOMY_LEVEL
  );
}

export async function createViabilityJobForCurrentUser(input: {
  currentUserId: string;
  ideaId: string;
  sprintDepth: string;
  autonomyLevel: string;
}) {
  const settings = validateDispatchSettings(input.sprintDepth, input.autonomyLevel);
  const inboxItem = await prisma.inboxItem.findFirst({
    where: {
      userId: input.currentUserId,
      bestIdeaId: input.ideaId
    },
    select: { id: true, userId: true }
  });

  if (
    !inboxItem ||
    !canDispatchIdeaForProfile({
      currentUserId: input.currentUserId,
      generatedForUserId: inboxItem.userId
    })
  ) {
    throw new Error("Idea is not available in this user's inbox");
  }

  return prisma.viabilityJob.create({
    data: {
      userId: input.currentUserId,
      ideaId: input.ideaId,
      sprintDepth: settings.sprintDepth,
      autonomyLevel: settings.autonomyLevel,
      status: "queued"
    }
  });
}
