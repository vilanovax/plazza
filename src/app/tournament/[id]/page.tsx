"use client";
import { use, useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, fetchMe } from "@/lib/client/api";
import { LoadingScreen, PageHeader, PageShell } from "@/components/ui";

interface Entry { userId: string; name: string; status: string; chips: number; place: number | null; rebuys: number; prize: number; }
interface Level { level: number; sb: number; bb: number; ante: number; minutes: number; isBreak?: boolean }
interface Detail {
  id: string; name: string; status: string; buyInChips: number; startingStack: number;
  maxPlayers: number; prizePool: number; currentLevel: number; levelEndsAt: string | null; tableId: string | null;
  config: { payouts: number[]; lateRegThroughLevel?: number; breakEveryLevels?: number; breakMinutes?: number };
  entries: Entry[];
  blindSchedule: Level[];
}

const STATUS_FA: Record<string, string> = { scheduled: "در انتظار", running: "در حال اجرا", finishing: "در حال پایان", finished: "پایان‌یافته", cancelled: "لغو" };

/** Split a pool by percentages, giving odd chips to first place. */
function prizeAmounts(pool: number, payouts: number[]): number[] {
  const amounts = payouts.map((p) => Math.floor((pool * p) / 100));
  const distributed = amounts.reduce((a, b) => a + b, 0);
  if (amounts.length && pool - distributed > 0) amounts[0] += pool - distributed;
  return amounts;
}

function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m.toLocaleString("fa")}:${(s % 60).toString().padStart(2, "0")}`;
}

export default function TournamentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now()); // ticking clock for the level countdown
  // Monotonic request counter: a slower earlier response is dropped so it can't
  // overwrite a newer one. Because `load` is recreated (and re-invoked) when the
  // id changes, an in-flight request for the previous id also loses the race and
  // is discarded — its data never bleeds into the new tournament's page.
  const genRef = useRef(0);

  const load = useCallback(() => {
    const gen = ++genRef.current;
    return api<Detail>(`/api/tournaments/${id}`)
      .then((v) => { if (gen === genRef.current) { setD(v); setErr(null); } })
      .catch((e) => { if (gen === genRef.current) setErr(e instanceof Error ? e.message : "خطا در دریافت اطلاعات تورنومنت"); });
  }, [id]);
  useEffect(() => {
    fetchMe()
      .then((u) => (u ? load() : router.replace("/login")))
      .catch(() => router.replace("/login"));
  }, [router, load]);
  useEffect(() => {
    const t = setInterval(load, 4000); // light polling for live standings
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000); // countdown tick
    return () => clearInterval(t);
  }, []);

  if (!d) {
    return (
      <PageShell>
        {err ? <p className="login-error" role="alert">{err}</p> : <LoadingScreen message="در حال بارگذاری تورنومنت…" />}
      </PageShell>
    );
  }

  const running = d.status === "running";
  const cur = d.blindSchedule.find((l) => l.level === d.currentLevel);
  const next = d.blindSchedule.find((l) => l.level === d.currentLevel + 1);
  const onBreak = cur?.isBreak === true;
  // Playable level = how many non-break entries up to and including the current
  // position — what a player thinks of as "level N" regardless of breaks.
  const playLevel = d.blindSchedule.slice(0, d.currentLevel).filter((l) => !l.isBreak).length;

  const active = d.entries.filter((e) => e.status === "active");
  const playersLeft = active.length;
  const totalChips = active.reduce((a, e) => a + e.chips, 0);
  const avgStack = playersLeft ? Math.floor(totalChips / playersLeft) : 0;

  const payouts = d.config.payouts ?? [];
  const paidPlaces = payouts.length;
  const amounts = prizeAmounts(d.prizePool, payouts);
  // On the bubble: one elimination away from the money. Flag the shortest active
  // stack (most likely to bust next) so players see the tension.
  const onBubble = running && paidPlaces > 0 && playersLeft === paidPlaces + 1;
  const shortStackId = onBubble
    ? active.reduce((min, e) => (e.chips < min.chips ? e : min), active[0])?.userId
    : null;

  const msLeft = running && d.levelEndsAt ? Date.parse(d.levelEndsAt) - now : 0;

  const lateReg = d.config.lateRegThroughLevel ?? 0;
  const lateRegOpen = running && lateReg > 0 && playLevel <= lateReg;

  const sorted = [...d.entries].sort((a, b) => {
    if (a.status === "active" && b.status !== "active") return -1;
    if (b.status === "active" && a.status !== "active") return 1;
    if (a.place && b.place) return a.place - b.place;
    return b.chips - a.chips;
  });

  return (
    <PageShell>
      <PageHeader title={`🏆 ${d.name}`} />

      {onBreak && (
        <div className="panel break-banner">
          ☕ استراحت{running && d.levelEndsAt ? ` — ادامه تا ${fmtCountdown(msLeft)}` : ""}
        </div>
      )}

      <section className="panel tournament-hero-panel info-grid">
        <Info label="وضعیت" value={STATUS_FA[d.status] ?? d.status} />
        <Info
          label={onBreak ? "استراحت" : "سطح فعلی"}
          value={onBreak ? "—" : `${playLevel.toLocaleString("fa")} · ${cur ? `${cur.sb.toLocaleString("fa")}/${cur.bb.toLocaleString("fa")}${cur.ante ? ` (آنته ${cur.ante.toLocaleString("fa")})` : ""}` : "—"}`}
        />
        {running && (
          <Info
            label={next ? "بعدی تا" : "آخرین سطح"}
            value={
              !next || !d.levelEndsAt
                ? "—"
                : next.isBreak
                  ? `${fmtCountdown(msLeft)} → ☕ استراحت`
                  : `${fmtCountdown(msLeft)} → ${next.sb.toLocaleString("fa")}/${next.bb.toLocaleString("fa")}`
            }
          />
        )}
        {running && <Info label="باقی‌مانده" value={`${playersLeft.toLocaleString("fa")} از ${d.entries.length.toLocaleString("fa")}`} />}
        {running && <Info label="میانگین استک" value={avgStack.toLocaleString("fa")} />}
        <Info label="مجموع جایزه" value={d.prizePool.toLocaleString("fa")} gold />
        <Info label="تقسیم جایزه" value={payouts.join("/") + "٪"} />
        {lateRegOpen && (
          <p style={{ gridColumn: "1 / -1", color: "var(--color-accent-400)", fontSize: "var(--text-sm)", fontWeight: 700 }}>
            🕒 ثبت‌نام با تأخیر تا پایان سطح {lateReg.toLocaleString("fa")} باز است
          </p>
        )}
        {running && d.tableId && (
          <div style={{ gridColumn: "1 / -1" }}>
            <Link href={`/table/${d.tableId}`} className="btn btn-primary" style={{ display: "block", textAlign: "center" }}>ورود به میز تورنومنت →</Link>
          </div>
        )}
      </section>

      {paidPlaces > 0 && (
        <section className="panel profile-section">
          <div className="profile-section-head">
            <h3 className="profile-section-title">جوایز</h3>
          </div>
          <div className="tournament-leaderboard">
            {payouts.map((p, i) => (
              <div key={i} className="list-row" style={{ padding: "0.4rem 0" }}>
                <span>{`رتبه ${(i + 1).toLocaleString("fa")}`} <span className="info-cell-label">({p.toLocaleString("fa")}٪)</span></span>
                <span className="stat-card-value--gold" style={{ fontWeight: 800 }}>{amounts[i].toLocaleString("fa")}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {onBubble && (
        <div className="panel bubble-banner">🫧 مرحله حباب — یک حذف تا رسیدن به جوایز</div>
      )}

      <h3 className="profile-section-title" style={{ marginBottom: "0.5rem" }}>جدول رده‌بندی</h3>
      <div className="tournament-leaderboard">
        {sorted.map((e) => (
          <article
            key={e.userId}
            className={`panel list-row tournament-entry${e.status !== "active" ? " tournament-entry--inactive" : ""}${e.userId === shortStackId ? " tournament-entry--bubble" : ""}`}
          >
            <div>
              <div className="table-card-name">
                {e.place ? `${e.place.toLocaleString("fa")}. ` : ""}{e.name}
                {e.status === "winner" && " 👑"}
                {e.userId === shortStackId && " 🫧"}
              </div>
              <div className="info-cell-label">
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
            {e.prize > 0 && <div className="stat-card-value--gold" style={{ fontWeight: 800 }}>+{e.prize.toLocaleString("fa")}</div>}
          </article>
        ))}
      </div>
    </PageShell>
  );
}

function Info({ label, value, gold }: { label: string; value: string; gold?: boolean }) {
  return (
    <div>
      <div className="info-cell-label">{label}</div>
      <div className={gold ? "info-cell-value info-cell-value--gold" : "info-cell-value"}>{value}</div>
    </div>
  );
}
