/** Image avatar ids (maps to /public/images/avatars/{id}.png). */
export const AVATARS = [
  "avatar-01", "avatar-02", "avatar-03", "avatar-04", "avatar-05", "avatar-06", "avatar-07",
  "avatar-08", "avatar-09", "avatar-10", "avatar-11", "avatar-12", "avatar-13", "avatar-14",
  "avatar-15", "avatar-16", "avatar-17", "avatar-18", "avatar-19", "avatar-20", "avatar-21",
] as const;

export type AvatarId = (typeof AVATARS)[number];

const AVATAR_SET = new Set<string>(AVATARS);

export function isAvatarId(id: string): id is AvatarId {
  return AVATAR_SET.has(id);
}

export function avatarImageSrc(id: string | undefined | null): string {
  if (id && isAvatarId(id)) return `/images/avatars/${id}.png`;
  return "/images/avatars/avatar-01.png";
}

/** Pick a stable default avatar from a user id (for legacy emoji profiles). */
export function defaultAvatarForUser(userId: string): AvatarId {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return AVATARS[h % AVATARS.length];
}
