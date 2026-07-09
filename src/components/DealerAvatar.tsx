"use client";

/**
 * Stylised croupier avatar shown at the top of the table felt.
 * Flat illustration: brown hair, glasses with cyan lenses, dark vest, cyan tie.
 */
export function DealerAvatar({ size = 64 }: { size?: number }) {
  return (
    <div style={{ textAlign: "center" }}>
      <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="دیلر میز">
        {/* badge background */}
        <circle cx="50" cy="50" r="48" fill="#0a5240" stroke="#d9b45b" strokeWidth="2.5" />
        <clipPath id="clip">
          <circle cx="50" cy="50" r="46" />
        </clipPath>
        <g clipPath="url(#clip)">
          {/* shoulders / vest */}
          <path d="M18 100 V78 Q18 66 32 62 L50 58 L68 62 Q82 66 82 78 V100 Z" fill="#3a4653" />
          {/* white shirt collar */}
          <path d="M42 60 L50 58 L58 60 L54 74 L50 66 L46 74 Z" fill="#eef2f6" />
          {/* tie */}
          <path d="M50 62 L54 68 L52 86 L48 86 L46 68 Z" fill="#22c3e6" />
          {/* neck */}
          <rect x="45" y="52" width="10" height="12" rx="4" fill="#f3c9a0" />
          {/* hair back */}
          <path d="M24 52 Q22 24 50 22 Q78 24 76 52 L76 66 Q70 58 66 58 L66 40 Q58 34 50 34 Q42 34 34 40 L34 58 Q30 58 24 66 Z" fill="#a05a2c" />
          {/* face */}
          <ellipse cx="50" cy="44" rx="17" ry="19" fill="#f7d9b5" />
          {/* fringe */}
          <path d="M33 40 Q34 30 50 29 Q66 30 67 40 Q58 33 50 33 Q42 33 33 40 Z" fill="#8f4d24" />
          {/* glasses */}
          <g stroke="#2b3440" strokeWidth="2.4" fill="#7fe6f7">
            <rect x="35" y="40" width="12" height="9" rx="4" />
            <rect x="53" y="40" width="12" height="9" rx="4" />
          </g>
          <path d="M47 44 H53" stroke="#2b3440" strokeWidth="2.4" fill="none" />
          {/* smile */}
          <path d="M45 54 Q50 58 55 54" stroke="#c98b63" strokeWidth="2" fill="none" strokeLinecap="round" />
        </g>
      </svg>
      <div style={{ fontSize: 10, color: "var(--gold)", marginTop: 2, fontWeight: 700 }}>دیلر</div>
    </div>
  );
}
