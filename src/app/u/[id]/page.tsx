"use client";
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, fetchMe } from "@/lib/client/api";
import { stringToCard } from "@/lib/poker/cards";
import { PlayingCard } from "@/components/PlayingCard";
import { LoadingScreen, PageHeader, PageShell } from "@/components/ui";

interface Honor { icon: string; label: string }
interface Stats {
  handsPlayed: number; handsWon: number; winRate: number; tablesPlayed: number;
  biggestWin: number; biggestPot: number; buyInCount: number; totalBought: number;
  netLifetime: number; bestHandName: string | null;
}
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
  const [prevId, setPrevId] = useState(id);
  if (prevId !== id) { setPrevId(id); setP(null); setErr(""); }

  useEffect(() => {
    let stale = false;
    fetchMe()
      .then((u) => {
        if (!u) return router.replace("/login");
        return api<{ profile: PublicProfile }>(`/api/users/${id}/profile`).then((d) => { if (!stale) setP(d.profile); });
      })
      .catch((e) => { if (!stale) setErr(e instanceof Error ? e.message : "خطا"); });
    return () => { stale = true; };
  }, [id, router]);

  if (err) {
    return (
      <PageShell>
        <p className="login-error" role="alert">{err}</p>
      </PageShell>
    );
  }
  if (!p) return <LoadingScreen message="در حال بارگذاری پروفایل…" />;

  return (
    <PageShell style={{ "--profile-chip": p.chipColor || "var(--gold)" } as React.CSSProperties}>
      <PageHeader title="پروفایل بازیکن" />

      <section className="panel profile-hero public-profile-hero" aria-label="پروفایل بازیکن">
        <div className="profile-hero-top">
          <div className="profile-avatar-wrap">
            <div className="profile-avatar-ring">
              <span className="profile-avatar-emoji">{p.avatar || "🙂"}</span>
            </div>
          </div>
          <div className="profile-hero-info">
            <h2 className="profile-hero-name">{p.displayName}</h2>
            {p.title && <span className="profile-hero-title">{p.title}</span>}
            {p.tagline && <p className="profile-hero-tagline">«{p.tagline}»</p>}
          </div>
        </div>
        {p.favoriteCards.length > 0 && (
          <div className="profile-hero-cards">
            {p.favoriteCards.map((c) => (
              <span key={c} className="playing-card-wrap">
                <PlayingCard card={stringToCard(c)} />
              </span>
            ))}
          </div>
        )}
      </section>

      {p.honors && p.honors.length > 0 && (
        <section className="panel profile-section">
          <div className="profile-section-head">
            <span className="profile-section-icon" aria-hidden>🏅</span>
            <h3 className="profile-section-title">افتخارات</h3>
          </div>
          <div className="table-card-meta">
            {p.honors.map((h, i) => (
              <span key={i} className="meta-pill meta-pill--gold">{h.icon} {h.label}</span>
            ))}
          </div>
        </section>
      )}

      {p.stats ? (
        <section className="panel profile-section">
          <div className="profile-section-head">
            <span className="profile-section-icon" aria-hidden>📊</span>
            <h3 className="profile-section-title">آمار کلی</h3>
          </div>
          <div className="stat-grid">
            <StatCard label="دست‌های برنده / کل" value={`${p.stats.handsWon.toLocaleString("fa")} / ${p.stats.handsPlayed.toLocaleString("fa")}`} />
            <StatCard label="درصد برد" value={`${p.stats.winRate.toLocaleString("fa")}٪`} gold />
            <StatCard label="بزرگ‌ترین پات" value={p.stats.biggestPot.toLocaleString("fa")} gold />
            <StatCard label="بزرگ‌ترین برد" value={p.stats.biggestWin.toLocaleString("fa")} />
            <StatCard label="بهترین دست" value={p.stats.bestHandName ?? "—"} gold />
            <StatCard label="تعداد خرید" value={p.stats.buyInCount.toLocaleString("fa")} />
            <StatCard label="میزهای بازی‌شده" value={p.stats.tablesPlayed.toLocaleString("fa")} />
            <StatCard
              label="سود/زیان کل"
              value={`${p.stats.netLifetime >= 0 ? "+" : ""}${p.stats.netLifetime.toLocaleString("fa")}`}
              tone={p.stats.netLifetime >= 0 ? "success" : "danger"}
            />
          </div>
        </section>
      ) : (
        <div className="panel empty-state">
          <p className="empty-state-desc">این بازیکن آمار خود را خصوصی کرده است.</p>
        </div>
      )}
    </PageShell>
  );
}

function StatCard({ label, value, gold, tone }: { label: string; value: string; gold?: boolean; tone?: "success" | "danger" }) {
  const valueClass = gold
    ? "stat-card-value stat-card-value--gold"
    : tone === "success"
      ? "stat-card-value"
      : tone === "danger"
        ? "stat-card-value"
        : "stat-card-value";
  const color = tone === "success" ? "var(--color-accent-400)" : tone === "danger" ? "var(--color-danger-300)" : undefined;
  return (
    <div className="panel stat-card">
      <div className="stat-card-label">{label}</div>
      <div className={valueClass} style={color ? { color } : undefined}>{value}</div>
    </div>
  );
}
