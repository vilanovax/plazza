"use client";
import { use, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, fetchMe } from "@/lib/client/api";

interface Entry { userId: string; name: string; status: string; chips: number; place: number | null; rebuys: number; prize: number; }
interface Detail {
  id: string; name: string; status: string; buyInChips: number; startingStack: number;
  maxPlayers: number; prizePool: number; currentLevel: number; tableId: string | null;
  config: { payouts: number[] }; entries: Entry[];
  blindSchedule: { level: number; sb: number; bb: number; ante: number; minutes: number }[];
}

const STATUS_FA: Record<string, string> = { scheduled: "در انتظار", running: "در حال اجرا", finished: "پایان‌یافته", cancelled: "لغو" };

export default function TournamentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [d, setD] = useState<Detail | null>(null);

  const load = useCallback(() => api<Detail>(`/api/tournaments/${id}`).then(setD).catch(() => {}), [id]);
  useEffect(() => { fetchMe().then((u) => (u ? load() : router.replace("/login"))); }, [router, load]);
  useEffect(() => {
    const t = setInterval(load, 4000); // light polling for live standings
    return () => clearInterval(t);
  }, [load]);

  if (!d) return <main style={{ padding: 24 }}>در حال بارگذاری…</main>;

  const sorted = [...d.entries].sort((a, b) => {
    if (a.status === "active" && b.status !== "active") return -1;
    if (b.status === "active" && a.status !== "active") return 1;
    if (a.place && b.place) return a.place - b.place;
    return b.chips - a.chips;
  });

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: 16 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <Link href="/" className="btn btn-ghost" style={{ padding: "0.3rem 0.7rem", fontSize: 13 }}>→ لابی</Link>
        <h1 style={{ fontSize: 19, margin: 0 }}>🏆 {d.name}</h1>
      </header>

      <div className="panel" style={{ padding: 16, marginBottom: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <Info label="وضعیت" value={STATUS_FA[d.status] ?? d.status} />
        <Info label="سطح فعلی" value={d.currentLevel.toLocaleString("fa")} />
        <Info label="مجموع جایزه" value={d.prizePool.toLocaleString("fa")} gold />
        <Info label="تقسیم جایزه" value={d.config.payouts.join("/") + "٪"} />
        {d.status === "running" && d.tableId && (
          <div style={{ gridColumn: "1 / -1" }}>
            <Link href={`/table/${d.tableId}`} className="btn btn-primary" style={{ display: "block", textAlign: "center" }}>ورود به میز تورنومنت →</Link>
          </div>
        )}
      </div>

      <h3 style={{ fontSize: 15, color: "var(--muted)" }}>جدول رده‌بندی</h3>
      <div style={{ display: "grid", gap: 6 }}>
        {sorted.map((e) => (
          <div key={e.userId} className="panel" style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", opacity: e.status === "active" ? 1 : 0.65 }}>
            <div>
              <div style={{ fontWeight: 700 }}>
                {e.place ? `${e.place.toLocaleString("fa")}. ` : ""}{e.name}
                {e.status === "winner" && " 👑"}
              </div>
              <div style={{ color: "var(--muted)", fontSize: 12 }}>
                {e.status === "active"
                  ? `استک: ${e.chips.toLocaleString("fa")}`
                  : e.status === "busted"
                    ? "حذف‌شده"
                    : e.status === "winner"
                      ? "برنده"
                      : "ثبت‌نام شده"}
                {e.rebuys > 0 ? ` · ری‌بای: ${e.rebuys.toLocaleString("fa")}` : ""}
              </div>
            </div>
            {e.prize > 0 && <div style={{ color: "var(--gold)", fontWeight: 800 }}>+{e.prize.toLocaleString("fa")}</div>}
          </div>
        ))}
      </div>
    </main>
  );
}

function Info({ label, value, gold }: { label: string; value: string; gold?: boolean }) {
  return (
    <div>
      <div style={{ color: "var(--muted)", fontSize: 12 }}>{label}</div>
      <div style={{ fontWeight: 800, color: gold ? "var(--gold)" : "var(--text)" }}>{value}</div>
    </div>
  );
}
