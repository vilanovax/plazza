"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, fetchMe } from "@/lib/client/api";
import { stringToCard } from "@/lib/poker/cards";
import { PlayingCard } from "@/components/PlayingCard";

interface Honor { icon: string; label: string }
interface Stats { handsPlayed: number; handsWon: number; winRate: number; tablesPlayed: number; biggestWin: number; biggestPot: number; buyInCount: number; totalBought: number; netLifetime: number; bestHandName: string | null }
interface PublicProfile {
  userId: string; displayName: string; avatar: string; title: string; tagline: string;
  favoriteCards: string[]; cardBack: string; chipColor: string; statsVisible: boolean;
  stats?: Stats; honors?: Honor[];
}

export default function PublicProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [p, setP] = useState<PublicProfile | null>(null);
  const [err, setErr] = useState("");
  // Reset view state during render when the id changes (React's documented
  // pattern) so the previous profile/error never lingers on the new page.
  const [prevId, setPrevId] = useState(id);
  if (prevId !== id) { setPrevId(id); setP(null); setErr(""); }

  useEffect(() => {
    // Guard against out-of-order responses when navigating between profiles.
    let stale = false;
    fetchMe()
      .then((u) => {
        if (!u) return router.replace("/login");
        return api<{ profile: PublicProfile }>(`/api/users/${id}/profile`).then((d) => { if (!stale) setP(d.profile); });
      })
      .catch((e) => { if (!stale) setErr(e instanceof Error ? e.message : "خطا"); });
    return () => { stale = true; };
  }, [id, router]);

  if (err) return <main style={{ padding: 24, color: "var(--danger,#e33)" }}>{err}</main>;
  if (!p) return <main style={{ padding: 24 }}>در حال بارگذاری…</main>;

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: 16 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <Link href="/" className="btn btn-ghost" style={{ padding: "0.3rem 0.7rem", fontSize: 13 }}>→ لابی</Link>
        <h1 style={{ fontSize: 19, margin: 0 }}>پروفایل بازیکن</h1>
      </header>

      <div className="panel" style={{ padding: 18, marginBottom: 14, display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ fontSize: 46, lineHeight: 1 }}>{p.avatar || "🙂"}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 20 }}>{p.displayName} {p.title && <span style={{ color: "var(--gold)", fontSize: 13 }}>«{p.title}»</span>}</div>
          {p.tagline && <div style={{ color: "var(--muted)", fontSize: 13 }}>“{p.tagline}”</div>}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {p.favoriteCards.map((c) => <PlayingCard key={c} card={stringToCard(c)} small />)}
        </div>
      </div>

      {p.honors && p.honors.length > 0 && (
        <div className="panel" style={{ padding: 14, marginBottom: 14 }}>
          <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 8 }}>افتخارات</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {p.honors.map((h, i) => (
              <span key={i} className="panel" style={{ padding: "4px 10px", borderColor: "var(--gold)", fontSize: 13 }}>{h.icon} {h.label}</span>
            ))}
          </div>
        </div>
      )}

      {p.stats ? (
        <div className="panel" style={{ padding: 16 }}>
          <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 10 }}>آمار کلی</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Stat label="دست‌های برنده / کل" value={`${p.stats.handsWon.toLocaleString("fa")} / ${p.stats.handsPlayed.toLocaleString("fa")}`} />
            <Stat label="درصد برد" value={`${p.stats.winRate.toLocaleString("fa")}٪`} gold />
            <Stat label="بزرگ‌ترین پات برده‌شده" value={p.stats.biggestPot.toLocaleString("fa")} gold />
            <Stat label="بزرگ‌ترین برد" value={p.stats.biggestWin.toLocaleString("fa")} />
            <Stat label="بهترین دست" value={p.stats.bestHandName ?? "—"} gold />
            <Stat label="تعداد دفعات خرید" value={p.stats.buyInCount.toLocaleString("fa")} />
            <Stat label="تعداد میزهای بازی‌شده" value={p.stats.tablesPlayed.toLocaleString("fa")} />
            <Stat label="کل ژتون خریداری‌شده" value={p.stats.totalBought.toLocaleString("fa")} />
            <Stat label="سود/زیان کل" value={`${p.stats.netLifetime >= 0 ? "+" : ""}${p.stats.netLifetime.toLocaleString("fa")}`} color={p.stats.netLifetime >= 0 ? "var(--accent)" : "var(--danger)"} />
          </div>
        </div>
      ) : (
        <div className="panel" style={{ padding: 16, color: "var(--muted)" }}>این بازیکن آمار خود را خصوصی کرده است.</div>
      )}
    </main>
  );
}

function Stat({ label, value, gold, color }: { label: string; value: string; gold?: boolean; color?: string }) {
  return (
    <div>
      <div style={{ color: "var(--muted)", fontSize: 12 }}>{label}</div>
      <div style={{ fontWeight: 800, color: color ?? (gold ? "var(--gold)" : "var(--text)") }}>{value}</div>
    </div>
  );
}
