export function canViewUserResearch(input: { currentUserId: string; targetUserId: string }) {
  void input;
  return true;
}

export function canEditProfile(input: { currentUserId: string; targetUserId: string }) {
  return input.currentUserId === input.targetUserId;
}
