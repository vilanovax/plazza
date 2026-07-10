"use client";

import Image from "next/image";

/** Croupier avatar at the top of the table felt. */
export function DealerAvatar({ size = 64 }: { size?: number }) {
  return (
    <div className="dealer-avatar">
      <div className="dealer-avatar-frame" style={{ width: size, height: size }}>
        <Image
          src="/images/dealer-avatar.png"
          alt="دیلر میز"
          width={size}
          height={size}
          className="dealer-avatar-img"
          priority
        />
      </div>
      <div className="dealer-avatar-label">دیلر</div>
    </div>
  );
}
