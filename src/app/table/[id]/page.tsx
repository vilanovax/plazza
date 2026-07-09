"use client";
import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTableSocket } from "@/components/useTableSocket";
import { useTableSounds } from "@/components/useTableSounds";
import { DealerAvatar } from "@/components/DealerAvatar";
import { PlayingCard } from "@/components/PlayingCard";
import { api, fetchMe, type Me } from "@/lib/client/api";
import type { PublicGameState, PlayerAction, TableConfig, LogEntry } from "@/lib/poker/types";

type PreAction = "fold" | "check_fold" | "check";
const BETTING_PHASES = new Set(["preflop", "flop", "turn", "river"]);

interface TournamentBanner {
  id: string; level: number; sb: number; bb: number; ante: number;
  prizePool: number; playersLeft: number; buyInChips: number; canRebuy: boolean;
  onBreak?: boolean; lateRegOpen?: boolean;
}
import { evaluate, CATEGORY_NAMES_FA } from "@/lib/poker/evaluator";
import { stringToCard, type Card } from "@/lib/poker/cards";
import { QUICK_CHAT } from "@/lib/profile/presets";

type SeatVM = PublicGameState["seats"][number];

/** Best current hand name from visible cards, once at least 5 are known. */
function currentHandName(holeCards: Card[] | undefined, community: Card[]): string | null {
  if (!holeCards || holeCards.length < 2) return null;
  const all = [...holeCards, ...community];
  if (all.length < 5) return null;
  return CATEGORY_NAMES_FA[evaluate(all).category];
}

const PHASE_FA: Record<string, string> = {
  waiting: "در انتظار بازیکنان", preflop: "پیش‌فلاپ", flop: "فلاپ", turn: "ترن",
  river: "ریور", showdown: "رو کردن", hand_complete: "پایان دست",
};

export default function TablePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { state, connected, error, clearError, sit, leaveSeat, act, topup, showCards, sitOut, requestExtraTime, kick, rebuy, chat } = useTableSocket(id);
  const [me, setMe] = useState<Me | null>(null);
  const [tourney, setTourney] = useState<TournamentBanner | null>(null);
  const [sitSeat, setSitSeat] = useState<number | null>(null);
  const [statsFor, setStatsFor] = useState<{ userId: string; name: string; seatIndex: number } | null>(null);
  // Pre-selected action to auto-run when it becomes the player's turn.
  const [preAction, setPreAction] = useState<{ type: PreAction; handNo: number } | null>(null);
  // Chat mute prefs (client-side): a set of muted user ids + a mute-everyone flag.
  const [mutedUsers, setMutedUsers] = useState<Set<string>>(new Set());
  const [muteAll, setMuteAll] = useState(false);
  const toggleMuteUser = useCallback((uid: string) => setMutedUsers((prev) => {
    const next = new Set(prev);
    if (next.has(uid)) next.delete(uid); else next.add(uid);
    return next;
  }), []);
  // The player's own pinned quick-emotes (sent as chat with one tap).
  const [myEmotes, setMyEmotes] = useState<string[]>([]);

  useEffect(() => { fetchMe().then((u) => (u ? setMe(u) : router.replace("/login"))); }, [router]);
  useEffect(() => { api<{ profile: { emotes: string[] } }>("/api/profile").then((d) => setMyEmotes(d.profile.emotes)).catch(() => {}); }, []);

  // Poll the tournament summary (if this table belongs to one).
  const loadTourney = useCallback(() => {
    api<{ tournament: TournamentBanner | null }>(`/api/tournaments/by-table/${id}`).then((d) => setTourney(d.tournament)).catch(() => {});
  }, [id]);
  useEffect(() => { loadTourney(); }, [loadTourney]);
  useEffect(() => {
    if (state?.phase === "hand_complete") loadTourney();
  }, [state?.phase, state?.handNo, loadTourney]);
  // Blind levels advance on a server-side timer independent of hand completion,
  // so poll on a short interval to keep the level/blinds/rebuy banner fresh.
  useEffect(() => {
    if (!tourney) return; // not a tournament table — no need to poll
    const t = setInterval(loadTourney, 5000);
    return () => clearInterval(t);
  }, [tourney, loadTourney]);

  const seatCount = state?.config.maxSeats ?? 6;
  const viewerSeat = state?.viewerSeat ?? null;
  const mySeat = viewerSeat != null ? state?.seats[viewerSeat] : undefined;
  const { muted, toggleMute } = useTableSounds(state, viewerSeat);

  const clearPre = useCallback(() => setPreAction(null), []);
  const selectPre = useCallback(
    (t: PreAction) => setPreAction((cur) => (cur?.type === t ? null : { type: t, handNo: state?.handNo ?? 0 })),
    [state?.handNo]
  );

  // Execute (or invalidate) a pre-selected action as the game state changes.
  // Clearing the one-shot selection here (a reaction to the live game-state
  // stream) is intentional, so the set-state-in-effect rule is disabled.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!state || viewerSeat == null || !preAction) return;
    // A pre-action only applies to the hand it was chosen in.
    if (preAction.handNo !== state.handNo) return clearPre();
    const seat = state.seats[viewerSeat];
    const betting = BETTING_PHASES.has(state.phase);
    if (!seat || seat.status !== "active" || !betting) return clearPre();

    const toCall = state.currentBet - seat.betThisRound;
    if (state.currentTurnSeat === viewerSeat) {
      // Our turn — run the pre-selected decision.
      if (preAction.type === "fold") act({ type: "fold" });
      else if (preAction.type === "check_fold") act(toCall > 0 ? { type: "fold" } : { type: "check" });
      else if (preAction.type === "check" && toCall <= 0) act({ type: "check" });
      clearPre();
    } else if (preAction.type === "check" && toCall > 0) {
      // Someone bet before our turn — "check" is no longer possible, so cancel.
      clearPre();
    }
  }, [state, viewerSeat, preAction, act, clearPre]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: 12, minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <Link href="/" className="btn btn-ghost" style={{ padding: "0.3rem 0.7rem", fontSize: 13 }}>→ لابی</Link>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontWeight: 800 }}>{state?.config.name ?? "میز"}</div>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>
            {state ? `${PHASE_FA[state.phase]} · بلایند ${state.config.smallBlind}/${state.config.bigBlind}` : "…"}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={toggleMute}
            aria-label={muted ? "روشن کردن صدا" : "قطع صدا"}
            className="btn btn-ghost"
            style={{ padding: "0.25rem 0.5rem", fontSize: 16, lineHeight: 1 }}
          >
            {muted ? "🔇" : "🔊"}
          </button>
          <span style={{ fontSize: 12, color: connected ? "var(--accent)" : "var(--danger)" }}>{connected ? "متصل" : "قطع"}</span>
        </div>
      </header>

      {tourney && (
        <div className="panel" style={{ padding: "6px 12px", marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center", borderColor: "var(--gold)", fontSize: 12 }}>
          <span>
            {tourney.onBreak ? "☕ استراحت" : `🏆 سطح ${tourney.level.toLocaleString("fa")} · بلایند ${tourney.sb.toLocaleString("fa")}/${tourney.bb.toLocaleString("fa")}${tourney.ante ? ` (آنته ${tourney.ante.toLocaleString("fa")})` : ""}`}
            {tourney.lateRegOpen && !tourney.onBreak ? " · 🕒 ثبت‌نام باز" : ""}
          </span>
          <span style={{ color: "var(--gold)" }}>جایزه {tourney.prizePool.toLocaleString("fa")} · {tourney.playersLeft.toLocaleString("fa")} نفر</span>
        </div>
      )}
      {tourney?.canRebuy && (
        <button className="btn btn-gold" style={{ marginBottom: 6 }} onClick={rebuy}>
          ری‌بای ({tourney.buyInChips.toLocaleString("fa")} چیپ)
        </button>
      )}

      {/* Felt */}
      <div style={{ position: "relative", flex: 1, minHeight: 420, margin: "8px 0" }}>
        <div style={{
          position: "absolute", inset: "6% 3%", borderRadius: "48%/40%",
          background: "radial-gradient(120% 120% at 50% 30%, var(--felt-2), var(--felt) 60%, #06281d)",
          border: "8px solid #5b3b1e", boxShadow: "inset 0 0 60px rgba(0,0,0,.5), 0 10px 30px rgba(0,0,0,.4)",
        }} />
        {/* Dealer avatar in the felt interior, above the community cards */}
        <div style={{ position: "absolute", top: "20%", left: "50%", transform: "translateX(-50%)", zIndex: 2 }}>
          <DealerAvatar size={56} />
        </div>
        {/* Center: pot + community */}
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <div style={{ color: "var(--gold)", fontWeight: 800 }}>پات: {(state?.pot ?? 0).toLocaleString("fa")}</div>
          <div style={{ display: "flex", gap: 5 }}>
            {[0, 1, 2, 3, 4].map((i) => {
              const c = state?.community[i];
              return c != null ? <PlayingCard key={i} card={c} /> : <div key={i} style={{ width: 46, height: 64, borderRadius: 7, border: "1px dashed rgba(255,255,255,.12)" }} />;
            })}
          </div>
          {state?.lastResult && state.phase === "hand_complete" && (
            <div style={{ marginTop: 6, textAlign: "center", fontSize: 13 }}>
              {state.lastResult.pots.map((p, i) => (
                <div key={i} style={{ color: "var(--gold)" }}>
                  برنده: {p.winners.map((w) => `${state.seats[w.seatIndex]?.name ?? "?"} (+${w.amount.toLocaleString("fa")})`).join("، ")}
                  {p.winners[0]?.handName ? ` — ${p.winners[0].handName}` : ""}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Seats */}
        {Array.from({ length: seatCount }).map((_, i) => {
          const pos = seatPosition(i, viewerSeat, seatCount);
          const seat = state?.seats[i];
          const isTurn = state?.currentTurnSeat === i;
          const isButton = state?.buttonSeat === i && state?.phase !== "waiting";
          const occupied = seat && seat.status !== "empty";
          return (
            <div key={i} style={{ position: "absolute", left: `${pos.x}%`, top: `${pos.y}%`, transform: "translate(-50%,-50%)", width: 96 }}>
              {occupied ? (
                <SeatView
                  seat={seat!}
                  isTurn={isTurn}
                  isButton={isButton}
                  community={state?.community ?? []}
                  deadline={isTurn ? state?.actionDeadline : undefined}
                  showdown={state?.phase === "hand_complete"}
                  onSelect={() => seat!.userId && setStatsFor({ userId: seat!.userId, name: seat!.name ?? "بازیکن", seatIndex: i })}
                />
              ) : (
                <button className="btn btn-ghost" style={{ width: "100%", fontSize: 12, padding: "0.5rem" }}
                  onClick={() => mySeat ? null : setSitSeat(i)} disabled={!!mySeat}>
                  {mySeat ? "خالی" : "نشستن"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {state && viewerSeat != null && state.phase === "hand_complete" &&
        state.showOfferSeat === viewerSeat && state.showOfferUntil && (
          <ShowCardsPrompt until={state.showOfferUntil} onShow={showCards} />
        )}

      {error && (
        <div onClick={clearError} className="panel" style={{ padding: "0.6rem 1rem", marginBottom: 8, borderColor: "var(--danger)", color: "var(--danger)", cursor: "pointer" }}>
          {error} <span style={{ float: "left", opacity: 0.6 }}>✕</span>
        </div>
      )}

      {/* Controls */}
      {mySeat ? (
        <ActionBar
          state={state!}
          mySeat={mySeat}
          act={act}
          topup={topup}
          leaveSeat={leaveSeat}
          preAction={preAction?.type ?? null}
          onPreAction={selectPre}
          sitOut={sitOut}
          requestExtraTime={requestExtraTime}
        />
      ) : (
        <div className="panel" style={{ padding: 12, textAlign: "center", color: "var(--muted)" }}>
          برای بازی روی یک صندلی خالی بزنید و بنشینید.
        </div>
      )}

      {state && <AllInFlash log={state.log ?? []} />}
      {state && (
        <ChatPanel
          log={state.log ?? []}
          myId={me?.id ?? null}
          muteAll={muteAll}
          mutedUsers={mutedUsers}
          emotes={myEmotes}
          onToggleMuteAll={() => setMuteAll((m) => !m)}
          onToggleMuteUser={toggleMuteUser}
          onSend={(text) => chat(text)}
        />
      )}

      {sitSeat != null && state && me && (
        <SitDialog seat={sitSeat} config={state.config} balance={me.chipBalance}
          onCancel={() => setSitSeat(null)}
          onSit={(buyIn) => { sit(sitSeat, buyIn); setSitSeat(null); }} />
      )}

      {statsFor && (
        <PlayerStatsModal
          tableId={id}
          userId={statsFor.userId}
          name={statsFor.name}
          canKick={me?.role === "admin" && statsFor.userId !== me?.id}
          onKick={() => { kick(statsFor.seatIndex, statsFor.userId); setStatsFor(null); }}
          onClose={() => setStatsFor(null)}
        />
      )}
    </main>
  );
}

function seatPosition(index: number, viewerSeat: number | null, n: number) {
  const anchor = viewerSeat ?? 0;
  const displayPos = ((index - anchor) % n + n) % n;
  const theta = Math.PI / 2 + (displayPos * 2 * Math.PI) / n;
  return { x: 50 + 44 * Math.cos(theta), y: 50 + 43 * Math.sin(theta) };
}

function SeatView({ seat, isTurn, isButton, community, deadline, showdown, onSelect }: {
  seat: SeatVM; isTurn: boolean; isButton: boolean; community: Card[]; deadline?: number; showdown?: boolean; onSelect?: () => void;
}) {
  const folded = seat.status === "folded";
  // Show the current best hand for any cards we can actually see (the viewer's
  // own during play, everyone's at showdown), from the flop onward.
  const handName = !folded ? currentHandName(seat.holeCards, community) : null;
  return (
    <div
      onClick={onSelect}
      onKeyDown={(e) => { if (onSelect && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onSelect(); } }}
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      aria-label={onSelect ? `آمار ${seat.name ?? "بازیکن"}` : undefined}
      style={{ textAlign: "center", opacity: folded ? 0.45 : 1, cursor: onSelect ? "pointer" : "default" }}
    >
      {seat.betThisRound > 0 && (
        <div style={{ color: "var(--gold)", fontSize: 12, marginBottom: 2 }}>شرط: {seat.betThisRound.toLocaleString("fa")}</div>
      )}
      {handName && (
        <div style={{
          fontSize: 10, fontWeight: 700, color: "#0b3d2e", background: "var(--gold)",
          borderRadius: 6, padding: "1px 6px", marginBottom: 3, display: "inline-block",
        }}>
          {handName}
        </div>
      )}
      {showdown && seat.holeCards?.length && seat.tagline ? (
        <div style={{ fontSize: 9, fontStyle: "italic", color: "var(--muted)", marginBottom: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>“{seat.tagline}”</div>
      ) : null}
      <div style={{ display: "flex", justifyContent: "center", gap: 3, marginBottom: 3, minHeight: 48 }}>
        {seat.holeCards?.length ? seat.holeCards.map((c, i) => <PlayingCard key={i} card={c} small />) :
          seat.hasCards ? [0, 1].map((i) => <PlayingCard key={i} small hidden />) : null}
      </div>
      <div className="panel" style={{
        padding: "5px 6px", borderColor: isTurn ? "var(--gold)" : undefined,
        boxShadow: isTurn ? "0 0 0 2px var(--gold)" : undefined, position: "relative",
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {isButton ? "🅑 " : ""}{seat.avatar ? `${seat.avatar} ` : ""}{seat.name}{!seat.isConnected ? " ⚠" : ""}
        </div>
        {seat.title && (
          <div style={{ fontSize: 9, color: "var(--gold)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>«{seat.title}»</div>
        )}
        <div style={{ fontSize: 12, color: seat.chipColor || "var(--accent)" }}>{seat.stack.toLocaleString("fa")}</div>
        {seat.status === "allin" && <div style={{ fontSize: 10, color: "var(--danger)" }}>آل‌این</div>}
        {seat.sitOut && <div style={{ fontSize: 10, color: "var(--muted)" }}>سیت‌اوت</div>}
        {isTurn && deadline && <Countdown deadline={deadline} />}
      </div>
    </div>
  );
}

function Countdown({ deadline }: { deadline: number }) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const raf = requestAnimationFrame(tick); // first update on next frame (a callback, not sync)
    const t = setInterval(tick, 400);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(t);
    };
  }, []);
  const left = now > 0 ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;
  return <div style={{ position: "absolute", top: -6, left: -6, background: "var(--gold)", color: "#2a1e00", borderRadius: 10, fontSize: 11, fontWeight: 800, padding: "1px 6px" }}>{left ?? "•"}</div>;
}

function ChatPanel({ log, myId, muteAll, mutedUsers, emotes, onToggleMuteAll, onToggleMuteUser, onSend }: {
  log: LogEntry[];
  myId: string | null;
  muteAll: boolean;
  mutedUsers: Set<string>;
  emotes: string[];
  onToggleMuteAll: () => void;
  onToggleMuteUser: (uid: string) => void;
  onSend: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const [showPresets, setShowPresets] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Hide muted players' chat/all-in lines; table events always show.
  const visible = log.filter((e) => {
    if (e.kind !== "chat" && e.kind !== "allin") return true;
    const uid = e.author?.userId;
    if (!uid || uid === myId) return true;
    if (muteAll) return false;
    return !mutedUsers.has(uid);
  });
  const recent = visible.slice(-40);
  const lastEntryId = recent[recent.length - 1]?.id;

  useEffect(() => {
    // Key on the last entry's id, not length — once the window caps at 40 the
    // length stops changing but new messages still arrive.
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lastEntryId]);

  function send(t: string) {
    const msg = t.trim();
    if (!msg) return;
    onSend(msg);
    setText("");
    setShowPresets(false);
  }

  return (
    <div className="panel" style={{ marginTop: 8, padding: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>گفتگو و رویدادها</span>
        <button onClick={onToggleMuteAll} className="btn btn-ghost" style={{ fontSize: 11, padding: "0.1rem 0.5rem" }}>
          {muteAll ? "🔕 صدای همه بسته" : "🔔 صدای چت باز"}
        </button>
      </div>
      <div ref={scrollRef} style={{ maxHeight: 130, overflowY: "auto", fontSize: 12 }}>
        {recent.map((e) => {
          const mine = e.author?.userId && e.author.userId === myId;
          if (e.kind === "chat") {
            return (
              <div key={e.id} style={{ padding: "2px 0", lineHeight: 1.5, color: "var(--text)" }}>
                <b style={{ color: mine ? "var(--gold)" : "var(--accent)" }}>{e.author?.name ?? "?"}:</b> {e.text}
                {!mine && e.author?.userId && (
                  <button onClick={() => onToggleMuteUser(e.author!.userId)} title="میوت این بازیکن"
                    style={{ marginInlineStart: 6, fontSize: 10, background: "none", border: "none", cursor: "pointer", color: mutedUsers.has(e.author.userId) ? "var(--danger,#e33)" : "var(--muted)" }}>
                    {mutedUsers.has(e.author.userId) ? "🔇" : "🔈"}
                  </button>
                )}
              </div>
            );
          }
          if (e.kind === "allin") {
            return <div key={e.id} style={{ padding: "2px 0", fontWeight: 800, color: "var(--danger,#e33)" }}>⚡ {e.text}</div>;
          }
          return (
            <div key={e.id} style={{ padding: "2px 0", lineHeight: 1.5, color: "var(--muted)" }}>
              <span style={{ opacity: 0.55 }}>{new Date(e.ts).toLocaleTimeString("fa", { hour: "2-digit", minute: "2-digit" })}</span>
              {" — "}{e.text}
            </div>
          );
        })}
      </div>
      {showPresets && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, margin: "6px 0" }}>
          {QUICK_CHAT.map((q) => (
            <button key={q} onClick={() => send(q)} className="btn btn-ghost" style={{ fontSize: 11, padding: "0.15rem 0.5rem" }}>{q}</button>
          ))}
        </div>
      )}
      {emotes.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, margin: "6px 0" }}>
          {emotes.map((e) => (
            <button key={e} onClick={() => onSend(e)} style={{ fontSize: 18, padding: "0.1rem 0.35rem", borderRadius: 8, cursor: "pointer", border: "1px solid var(--border,#3334)", background: "transparent" }}>{e}</button>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
        <button onClick={() => setShowPresets((s) => !s)} className="btn btn-ghost" style={{ padding: "0.3rem 0.5rem" }} title="جملات آماده">💬</button>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(text); }}
          maxLength={200}
          placeholder="پیام…"
          style={{ flex: 1, padding: "0.35rem 0.6rem", borderRadius: 8, border: "1px solid var(--border,#3335)", background: "var(--panel,#1b1b1f)", color: "inherit", fontSize: 13 }}
        />
        <button onClick={() => send(text)} className="btn btn-primary" style={{ padding: "0.3rem 0.7rem" }}>ارسال</button>
      </div>
    </div>
  );
}

/** Brief full-width flash whenever a new all-in is announced in the feed.
 *  Keyed by the entry id so the CSS animation replays only on a NEW all-in
 *  (React remounts on key change) — no timers or state, so it's lint-clean. */
function AllInFlash({ log }: { log: LogEntry[] }) {
  const lastAllIn = [...log].reverse().find((e) => e.kind === "allin");
  if (!lastAllIn) return null;
  return (
    <div key={lastAllIn.id} style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none", zIndex: 80, animation: "allinflash 1.6s ease-out forwards" }}>
      <style>{"@keyframes allinflash{0%{opacity:0;transform:scale(.7)}15%{opacity:1;transform:scale(1.05)}70%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(1)}}"}</style>
      <div style={{ fontSize: 40, fontWeight: 900, color: "#fff", textShadow: "0 0 24px #e33, 0 0 8px #e33", background: "rgba(180,20,40,.35)", padding: "14px 36px", borderRadius: 16 }}>
        ⚡ {lastAllIn.author?.name ?? ""} — آل‌این! 🔥
      </div>
    </div>
  );
}

function ShowCardsPrompt({ until, onShow }: { until: number; onShow: () => void }) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setLeft(Math.max(0, Math.ceil((until - Date.now()) / 1000)));
    const raf = requestAnimationFrame(update);
    const t = setInterval(update, 300);
    return () => { cancelAnimationFrame(raf); clearInterval(t); };
  }, [until]);
  if (left !== null && left <= 0) return null;
  return (
    <div className="panel" style={{ padding: 10, marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "space-between", borderColor: "var(--gold)" }}>
      <span style={{ fontSize: 13, color: "var(--muted)" }}>می‌خواهی کارت‌هایت را نشان دهی؟</span>
      <button className="btn btn-gold" style={{ fontSize: 13 }} onClick={onShow}>
        نمایش کارت‌هایم{left !== null ? ` (${left.toLocaleString("fa")})` : ""}
      </button>
    </div>
  );
}

function ActionBar({ state, mySeat, act, topup, leaveSeat, preAction, onPreAction, sitOut, requestExtraTime }: {
  state: PublicGameState; mySeat: SeatVM;
  act: (a: PlayerAction) => void; topup: (n: number) => void; leaveSeat: () => void;
  preAction: PreAction | null; onPreAction: (t: PreAction) => void;
  sitOut: (out: boolean) => void; requestExtraTime: () => void;
}) {
  const myTurn = state.currentTurnSeat === mySeat.seatIndex && ["preflop", "flop", "turn", "river"].includes(state.phase);
  const etAllowed = state.config.extraTimeRequests; // -1 unlimited, 0 off
  const canExtraTime = etAllowed !== 0 && (etAllowed < 0 || (mySeat.extraTimeUsed ?? 0) < etAllowed);
  const toCall = Math.max(0, state.currentBet - mySeat.betThisRound);
  const maxTo = mySeat.betThisRound + mySeat.stack;
  const minRaiseTo = Math.min(maxTo, state.currentBet > 0 ? state.currentBet + state.minRaise : state.config.bigBlind);
  const [raiseTo, setRaiseTo] = useState(minRaiseTo);
  // Reset the slider whenever the betting context changes (React's render-time
  // "adjust state on prop change" pattern — no effect needed).
  const betKey = `${state.handNo}:${state.phase}:${state.currentBet}`;
  const [prevBetKey, setPrevBetKey] = useState(betKey);
  if (betKey !== prevBetKey) {
    setPrevBetKey(betKey);
    setRaiseTo(minRaiseTo);
  }

  const canRaise = maxTo > state.currentBet;
  const [showTopup, setShowTopup] = useState(false);
  const [topupAmt, setTopupAmt] = useState(state.config.topUpMin || state.config.bigBlind * 20);

  return (
    <div className="panel" style={{ padding: 10 }}>
      {myTurn ? (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button className="btn btn-danger" style={{ flex: 1 }} onClick={() => act({ type: "fold" })}>فولد</button>
            {toCall === 0 ? (
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => act({ type: "check" })}>چک</button>
            ) : (
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => act({ type: "call" })}>
                کال {toCall.toLocaleString("fa")}
              </button>
            )}
            <button className="btn btn-gold" style={{ flex: 1 }} disabled={!canRaise}
              onClick={() => act(raiseTo >= maxTo ? { type: "allin" } : { type: state.currentBet > 0 ? "raise" : "bet", amount: raiseTo })}>
              {state.currentBet > 0 ? "رِیز" : "بِت"} {raiseTo.toLocaleString("fa")}
            </button>
          </div>
          {canRaise && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="range" min={minRaiseTo} max={maxTo} value={raiseTo} step={state.config.smallBlind}
                onChange={(e) => setRaiseTo(Number(e.target.value))} style={{ flex: 1 }} />
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: "0.35rem 0.6rem" }} onClick={() => setRaiseTo(maxTo)}>آل‌این</button>
            </div>
          )}
          {canExtraTime && (
            <button className="btn btn-ghost" style={{ marginTop: 8, width: "100%", fontSize: 12 }} onClick={requestExtraTime}>
              ⏱ زمان اضافه (+{state.config.extraTimeSec.toLocaleString("fa")} ثانیه)
            </button>
          )}
        </>
      ) : (
        <div>
          {mySeat.status === "active" && ["preflop", "flop", "turn", "river"].includes(state.phase) && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ color: "var(--muted)", fontSize: 11, marginBottom: 4 }}>اقدام از پیش (وقتی نوبتت شد خودکار اجرا می‌شود)</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className={`btn ${preAction === "fold" ? "btn-danger" : "btn-ghost"}`} style={{ flex: 1, fontSize: 13 }} onClick={() => onPreAction("fold")}>فولد خودکار</button>
                <button className={`btn ${preAction === "check_fold" ? "btn-gold" : "btn-ghost"}`} style={{ flex: 1, fontSize: 13 }} onClick={() => onPreAction("check_fold")}>چک/فولد</button>
                <button className={`btn ${preAction === "check" ? "btn-primary" : "btn-ghost"}`} style={{ flex: 1, fontSize: 13 }} onClick={() => onPreAction("check")}>چک</button>
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ color: "var(--muted)", fontSize: 13 }}>
              موجودی میز: <b style={{ color: "var(--accent)" }}>{mySeat.stack.toLocaleString("fa")}</b>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className={`btn ${mySeat.sitOut ? "btn-primary" : "btn-ghost"}`} style={{ fontSize: 13 }} onClick={() => sitOut(!mySeat.sitOut)}>
                {mySeat.sitOut ? "بازگشت به بازی" : "سیت‌اوت"}
              </button>
              {state.config.allowTopUp && (
                <button className="btn btn-gold" style={{ fontSize: 13 }} onClick={() => setShowTopup((s) => !s)}>+ تاپ‌آپ</button>
              )}
              <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={leaveSeat}>خروج از میز</button>
            </div>
          </div>
        </div>
      )}

      {showTopup && (
        <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
          <input type="number" value={topupAmt} onChange={(e) => setTopupAmt(Number(e.target.value))}
            style={{ flex: 1, padding: "0.5rem", borderRadius: 8, border: "1px solid var(--card-border)", background: "rgba(0,0,0,.25)", color: "var(--text)" }} />
          <button className="btn btn-primary" onClick={() => { topup(topupAmt); setShowTopup(false); }}>درخواست</button>
        </div>
      )}
    </div>
  );
}

interface PlayerStats {
  displayName: string;
  profile?: { avatar: string; title: string; tagline: string; favoriteCards: string[]; cardBack: string; chipColor: string };
  statsPublic?: boolean;
  handsPlayed?: number; handsWon?: number; winRate?: number;
  buyInCount?: number; totalBought?: number; net?: number;
}
function StatRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,.08)" }}>
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <b style={{ color: color ?? "var(--text)" }}>{value}</b>
    </div>
  );
}
function PlayerStatsModal({ tableId, userId, name, canKick, onKick, onClose }: {
  tableId: string; userId: string; name: string; canKick?: boolean; onKick?: () => void; onClose: () => void;
}) {
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api<PlayerStats>(`/api/tables/${tableId}/player/${userId}/stats`)
      .then(setStats)
      .catch((e) => setErr((e as Error).message));
  }, [tableId, userId]);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "grid", placeItems: "center", zIndex: 60, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="panel" style={{ padding: 20, width: "100%", maxWidth: 340 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>📊 آمار {stats?.displayName ?? name}</h3>
          <button onClick={onClose} className="btn btn-ghost" style={{ padding: "0.2rem 0.5rem" }}>✕</button>
        </div>
        {stats?.profile && (stats.profile.avatar || stats.profile.title || stats.profile.tagline || stats.profile.favoriteCards.length > 0) && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, paddingBottom: 10, borderBottom: "1px solid rgba(255,255,255,.08)" }}>
            {stats.profile.avatar && <div style={{ fontSize: 32 }}>{stats.profile.avatar}</div>}
            <div style={{ flex: 1 }}>
              {stats.profile.title && <div style={{ color: "var(--gold)", fontSize: 13, fontWeight: 700 }}>«{stats.profile.title}»</div>}
              {stats.profile.tagline && <div style={{ color: "var(--muted)", fontSize: 12 }}>“{stats.profile.tagline}”</div>}
            </div>
            <div style={{ display: "flex", gap: 3 }}>
              {stats.profile.favoriteCards.map((c) => <PlayingCard key={c} card={stringToCard(c)} small />)}
            </div>
          </div>
        )}
        <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 8 }}>آمار این بازیکن در این میز</div>
        {err && <div style={{ color: "var(--danger)" }}>{err}</div>}
        {!stats && !err && <div style={{ color: "var(--muted)" }}>در حال بارگذاری…</div>}
        {stats && stats.statsPublic === false && (
          <div style={{ color: "var(--muted)", fontSize: 13 }}>این بازیکن آمار خود را خصوصی کرده است.</div>
        )}
        {stats && stats.statsPublic !== false && stats.handsPlayed !== undefined && (
          <div>
            <StatRow label="دست‌های برنده / کل" value={`${(stats.handsWon ?? 0).toLocaleString("fa")} / ${(stats.handsPlayed ?? 0).toLocaleString("fa")}`} />
            <StatRow label="درصد برد" value={`${(stats.winRate ?? 0).toLocaleString("fa")}٪`} color="var(--gold)" />
            <StatRow label="کل ژتون خریداری‌شده" value={(stats.totalBought ?? 0).toLocaleString("fa")} color="var(--accent)" />
            <StatRow label="تعداد دفعات خرید" value={(stats.buyInCount ?? 0).toLocaleString("fa")} />
            <StatRow label="سود/زیان خالص" value={`${(stats.net ?? 0) >= 0 ? "+" : ""}${(stats.net ?? 0).toLocaleString("fa")}`} color={(stats.net ?? 0) >= 0 ? "var(--accent)" : "var(--danger)"} />
          </div>
        )}
        {canKick && onKick && (
          <button className="btn btn-danger" style={{ width: "100%", marginTop: 14 }}
            onClick={() => { if (confirm(`${name} از میز حذف شود؟`)) onKick(); }}>
            حذف از میز (کیک)
          </button>
        )}
      </div>
    </div>
  );
}

function SitDialog({ seat, config, balance, onCancel, onSit }: {
  seat: number; config: TableConfig; balance: number;
  onCancel: () => void; onSit: (buyIn: number) => void;
}) {
  const maxAllowed = Math.min(config.maxBuyIn, balance);
  const [buyIn, setBuyIn] = useState(Math.min(config.maxBuyIn, Math.max(config.minBuyIn, maxAllowed)));
  const insufficient = balance < config.minBuyIn;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "grid", placeItems: "center", zIndex: 50, padding: 20 }}>
      <div className="panel" style={{ padding: 20, width: "100%", maxWidth: 340 }}>
        <h3 style={{ marginTop: 0 }}>نشستن روی صندلی {(seat + 1).toLocaleString("fa")}</h3>
        <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 10 }}>
          موجودی ژتون شما: {balance.toLocaleString("fa")} · ورود مجاز {config.minBuyIn.toLocaleString("fa")}–{config.maxBuyIn.toLocaleString("fa")}
        </div>
        {insufficient ? (
          <div style={{ color: "var(--danger)", fontSize: 14 }}>موجودی شما برای ورود کافی نیست. از مدیر ژتون بخواهید.</div>
        ) : (
          <>
            <input type="range" min={config.minBuyIn} max={maxAllowed} step={config.bigBlind} value={buyIn}
              onChange={(e) => setBuyIn(Number(e.target.value))} style={{ width: "100%" }} />
            <div style={{ textAlign: "center", fontWeight: 800, color: "var(--gold)", margin: "6px 0 12px" }}>{buyIn.toLocaleString("fa")} ژتون</div>
          </>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onCancel}>انصراف</button>
          <button className="btn btn-primary" style={{ flex: 1 }} disabled={insufficient} onClick={() => onSit(buyIn)}>نشستن</button>
        </div>
      </div>
    </div>
  );
}
