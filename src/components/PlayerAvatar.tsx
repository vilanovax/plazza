"use client";

import Image from "next/image";
import { avatarImageSrc, defaultAvatarForUser } from "@/lib/profile/avatars";

export function PlayerAvatar({
  avatar,
  userId,
  name,
  size = 40,
  className = "",
}: {
  avatar?: string;
  userId?: string;
  name?: string;
  size?: number;
  className?: string;
}) {
  const src = avatar?.startsWith("avatar-")
    ? avatarImageSrc(avatar)
    : avatarImageSrc(userId ? defaultAvatarForUser(userId) : undefined);

  return (
    <div className={`player-avatar ${className}`.trim()} style={{ width: size, height: size }}>
      <Image
        src={src}
        alt={name ? `آواتار ${name}` : "آواتار بازیکن"}
        width={size}
        height={size}
        className="player-avatar-img"
      />
    </div>
  );
}
