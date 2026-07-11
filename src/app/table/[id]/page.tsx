"use client";
import { use, useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTableSocket } from "@/components/useTableSocket";
import { useTableSounds } from "@/components/useTableSounds";
import { DealerAvatar } from "@/components/DealerAvatar";
import { ChipStack } from "@/components/ChipStack";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { PlayingCard } from "@/components/PlayingCard";
import { api, fetchMe, type Me } from "@/lib/client/api";
import { MQ_LANDSCAPE_SHORT, MQ_SM_MAX } from "@/lib/breakpoints";
import { Input, Modal, PageShell } from "@/components/ui";
import type { PublicGameState, PlayerAction, TableConfig, LogEntry } from "@/lib/poker/types";

type PreAction = "fold" | "check_fold" | "check";
const BETTING_PHASES = new Set(["preflop", "flop", "turn", "river"]);

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
  const { state, tourney, connected, error, clearError, sit, leaveSeat, act, topup, showCards, sitOut, requestExtraTime, kick, rebuy, forfeitTournament, chat } = useTableSocket(id);
  const [me, setMe] = useState<Me | null>(null);
  const [sitSeat, setSitSeat] = useState<number | null>(null);
  const [forfeitOpen, setForfeitOpen] = useState(false);
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
  // Stable across renders so the memoized SeatView isn't invalidated by a fresh
  // closure on every socket push (its comparator can then skip unchanged seats).
  const onSeatSelect = useCallback((seatIndex: number, userId: string | null, name: string | null) => {
    if (userId) setStatsFor({ userId, name: name ?? "بازیکن", seatIndex });
  }, []);

  useEffect(() => { fetchMe().then((u) => (u ? setMe(u) : router.replace("/login"))); }, [router]);
  useEffect(() => { api<{ profile: { emotes: string[] } }>("/api/profile").then((d) => setMyEmotes(d.profile.emotes)).catch(() => {}); }, []);

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

  const { compact, landscape } = useTableLayout();

  return (
    <PageShell table className={landscape ? "table-shell--landscape" : ""}>
      <header className="table-header">
        <Link href="/" className="btn btn-ghost page-back table-btn-sm">
          <span aria-hidden>→</span>
          لابی
        </Link>
        <div className="table-header-center">
          <div className="table-header-title">{state?.config.name ?? "میز"}</div>
          <div className="table-header-meta">
            {state ? `${PHASE_FA[state.phase]} · بلایند ${state.config.smallBlind}/${state.config.bigBlind}` : "…"}
          </div>
        </div>
        <div className="table-header-actions">
          <button
            onClick={toggleMute}
            aria-label={muted ? "روشن کردن صدا" : "قطع صدا"}
            className="btn btn-ghost table-mute-btn"
          >
            {muted ? "🔇" : "🔊"}
          </button>
          <span className={`table-status ${connected ? "table-status--ok" : "table-status--err"}`}>
            {connected ? "متصل" : "قطع"}
          </span>
        </div>
      </header>

      <TableLiveRegion state={state} viewerSeat={viewerSeat} />

      {tourney && (
        <div className="panel table-tourney-banner">
          <span>
            {tourney.onBreak ? "☕ استراحت" : `🏆 سطح ${tourney.level.toLocaleString("fa")} · بلایند ${tourney.sb.toLocaleString("fa")}/${tourney.bb.toLocaleString("fa")}${tourney.ante ? ` (آنته ${tourney.ante.toLocaleString("fa")})` : ""}`}
            {tourney.lateRegOpen && !tourney.onBreak ? " · 🕒 ثبت‌نام باز" : ""}
          </span>
          <span className="table-tourney-prize">جایزه {tourney.prizePool.toLocaleString("fa")} · {tourney.playersLeft.toLocaleString("fa")} نفر</span>
        </div>
      )}
      {tourney?.canRebuy && (
        <button className="btn btn-gold table-rebuy-btn" onClick={rebuy}>
          ری‌بای ({tourney.buyInChips.toLocaleString("fa")} چیپ)
        </button>
      )}

      <div className="table-play-area">
      <div className="table-felt-wrap">
        <div className="table-rail" aria-hidden>
          <div className="table-felt" />
        </div>
        <div className="table-dealer-anchor">
          <DealerAvatar size={compact ? 38 : 56} />
        </div>
        <div className="table-center">
          <div className="table-pot">
            <span className="table-pot-label">پات</span>
            <ChipStack amount={state?.pot ?? 0} compact={compact} showAmount />
          </div>
          <div className="table-community">
            {[0, 1, 2, 3, 4].map((i) => {
              const c = state?.community[i];
              return c != null ? <PlayingCard key={i} card={c} /> : <div key={i} className="table-card-slot" />;
            })}
          </div>
          {state?.lastResult && state.phase === "hand_complete" && (
            <div className="table-hand-result">
              {state.lastResult.pots.map((p, i) => (
                <div key={i} className="table-hand-result-line">
                  برنده: {p.winners.map((w) => `${state.seats[w.seatIndex]?.name ?? "?"} (+${w.amount.toLocaleString("fa")})`).join("، ")}
                  {p.winners[0]?.handName ? ` — ${p.winners[0].handName}` : ""}
                </div>
              ))}
            </div>
          )}
        </div>

        {Array.from({ length: seatCount }).map((_, i) => {
          const pos = seatPosition(i, viewerSeat, seatCount, { compact, landscape });
          const seat = state?.seats[i];
          const isTurn = state?.currentTurnSeat === i;
          const isButton = state?.buttonSeat === i && state?.phase !== "waiting";
          const occupied = seat && seat.status !== "empty";
          return (
            <div
              key={i}
              className={`table-seat-slot${i === viewerSeat ? " table-seat-slot--viewer" : ""}${occupied ? " table-seat-slot--occupied" : " table-seat-slot--empty"}`}
              style={{ "--seat-x": `${pos.x}%`, "--seat-y": `${pos.y}%` } as React.CSSProperties}
            >
              {occupied ? (
                <SeatView
                  seat={seat!}
                  isTurn={isTurn}
                  isButton={isButton}
                  isViewer={i === viewerSeat}
                  community={state?.community ?? []}
                  deadline={isTurn ? state?.actionDeadline : undefined}
                  showdown={state?.phase === "hand_complete"}
                  compact={compact}
                  chipOffset={{ x: pos.chipOx, y: pos.chipOy }}
                  onSelect={onSeatSelect}
                />
              ) : (
                <button className="btn btn-ghost seat-empty-btn"
                  onClick={() => mySeat ? null : setSitSeat(i)} disabled={!!mySeat}>
                  {mySeat ? (compact ? "·" : "خالی") : "نشستن"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="table-controls">
      {state && viewerSeat != null && state.phase === "hand_complete" &&
        state.showOfferSeat === viewerSeat && state.showOfferUntil && (
          <ShowCardsPrompt until={state.showOfferUntil} onShow={showCards} />
        )}

      {error && (
        <div onClick={clearError} className="panel table-error-banner" role="alert">
          {error} <span className="table-error-dismiss">✕</span>
        </div>
      )}

      {/* Controls */}
      {mySeat ? (
        <ActionBar
          compact={compact}
          state={state!}
          mySeat={mySeat}
          act={act}
          topup={topup}
          leaveSeat={leaveSeat}
          preAction={preAction?.type ?? null}
          onPreAction={selectPre}
          sitOut={sitOut}
          requestExtraTime={requestExtraTime}
          isTournament={!!tourney}
          onForfeit={() => setForfeitOpen(true)}
        />
      ) : (
        <div className="panel table-hint-panel">
          <span className="table-hint-icon" aria-hidden>♠</span>
          برای بازی روی یک صندلی خالی بزنید و بنشینید.
        </div>
      )}

      {state && <AllInFlash log={state.log ?? []} />}
      {state && (
        <ChatPanel
          compact={compact}
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
      </div>
      </div>

      {sitSeat != null && state && me && (
        <SitDialog seat={sitSeat} config={state.config} balance={me.chipBalance}
          onCancel={() => setSitSeat(null)}
          onSit={(buyIn) => { sit(sitSeat, buyIn); setSitSeat(null); }} />
      )}

      {forfeitOpen && mySeat && (
        <ForfeitTournamentModal
          stack={mySeat.stack}
          onCancel={() => setForfeitOpen(false)}
          onConfirm={() => { forfeitTournament(); setForfeitOpen(false); }}
        />
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
    </PageShell>
  );
}

function useTableLayout() {
  const [layout, setLayout] = useState({ compact: false, landscape: false });
  useEffect(() => {
    const mqCompact = window.matchMedia(MQ_SM_MAX);
    const mqLandscape = window.matchMedia(MQ_LANDSCAPE_SHORT);
    const update = () => setLayout({
      compact: mqCompact.matches || mqLandscape.matches,
      landscape: mqLandscape.matches,
    });
    update();
    mqCompact.addEventListener("change", update);
    mqLandscape.addEventListener("change", update);
    return () => {
      mqCompact.removeEventListener("change", update);
      mqLandscape.removeEventListener("change", update);
    };
  }, []);
  return layout;
}

function TableLiveRegion({ state, viewerSeat }: { state?: PublicGameState | null; viewerSeat: number | null }) {
  if (!state) return null;
  const parts: string[] = [PHASE_FA[state.phase] ?? state.phase];
  if (state.pot > 0) parts.push(`پات ${state.pot.toLocaleString("fa")}`);
  if (state.currentTurnSeat != null && state.phase !== "waiting" && state.phase !== "hand_complete") {
    const name = state.seats[state.currentTurnSeat]?.name ?? "بازیکن";
    parts.push(viewerSeat === state.currentTurnSeat ? "نوبت شماست" : `نوبت ${name}`);
  }
  return (
    <div className="sr-only" aria-live="polite" aria-atomic="true">
      {parts.join("، ")}
    </div>
  );
}

function seatPosition(
  index: number,
  viewerSeat: number | null,
  n: number,
  opts?: { compact?: boolean; landscape?: boolean },
) {
  const compact = opts?.compact ?? false;
  const landscape = opts?.landscape ?? false;
  const anchor = viewerSeat ?? 0;
  const displayPos = ((index - anchor) % n + n) % n;
  const theta = Math.PI / 2 + (displayPos * 2 * Math.PI) / n;
  const rx = landscape ? 42 : compact ? 36 : 44;
  const ry = landscape ? 30 : compact ? 34 : 43;
  const x = 50 + rx * Math.cos(theta);
  const y = 50 + ry * Math.sin(theta);
  const dx = 50 - x;
  const dy = 50 - y;
  const len = Math.hypot(dx, dy) || 1;
  const push = landscape ? 12 : compact ? 14 : 22;
  return {
    x,
    y,
    chipOx: (dx / len) * push,
    chipOy: (dy / len) * push,
  };
}

interface SeatViewProps {
  seat: SeatVM; isTurn: boolean; isButton: boolean; isViewer?: boolean; community: Card[]; deadline?: number; showdown?: boolean; compact?: boolean;
  chipOffset?: { x: number; y: number }; onSelect?: (seatIndex: number, userId: string | null, name: string | null) => void;
}

/**
 * The table re-broadcasts a brand-new state object on every socket push (each
 * action, chat line, timer refresh), so `seat`/`community` are always fresh
 * references and a shallow memo would never skip a render. This comparator does
 * a field-wise compare of everything the seat actually paints, so a broadcast
 * that doesn't touch THIS seat (e.g. a chat message, or another seat's bet)
 * skips both the re-render and the per-seat hand evaluation below.
 */
function seatViewEqual(a: SeatViewProps, b: SeatViewProps): boolean {
  if (
    a.isTurn !== b.isTurn || a.isButton !== b.isButton || a.isViewer !== b.isViewer ||
    a.showdown !== b.showdown || a.compact !== b.compact || a.deadline !== b.deadline ||
    a.onSelect !== b.onSelect
  ) return false;
  if (a.chipOffset?.x !== b.chipOffset?.x || a.chipOffset?.y !== b.chipOffset?.y) return false;
  if (a.community.length !== b.community.length) return false;
  for (let i = 0; i < a.community.length; i++) if (a.community[i] !== b.community[i]) return false;
  const s1 = a.seat, s2 = b.seat;
  if (
    s1.status !== s2.status || s1.betThisRound !== s2.betThisRound || s1.stack !== s2.stack ||
    s1.name !== s2.name || s1.title !== s2.title || s1.tagline !== s2.tagline ||
    s1.isConnected !== s2.isConnected || s1.sitOut !== s2.sitOut || s1.userId !== s2.userId ||
    s1.seatIndex !== s2.seatIndex || s1.avatar !== s2.avatar || s1.cardBack !== s2.cardBack ||
    s1.chipColor !== s2.chipColor || s1.hasCards !== s2.hasCards
  ) return false;
  const h1 = s1.holeCards, h2 = s2.holeCards;
  if ((h1?.length ?? 0) !== (h2?.length ?? 0)) return false;
  if (h1 && h2) for (let i = 0; i < h1.length; i++) if (h1[i] !== h2[i]) return false;
  return true;
}

const SeatView = memo(function SeatView({ seat, isTurn, isButton, isViewer, community, deadline, showdown, compact, chipOffset, onSelect }: SeatViewProps) {
  const folded = seat.status === "folded";
  // Show the current best hand for any cards we can actually see (the viewer's
  // own during play, everyone's at showdown), from the flop onward. Memoised so
  // a re-render that leaves the visible cards unchanged skips the evaluation.
  const handName = useMemo(
    () => (folded ? null : currentHandName(seat.holeCards, community)),
    [folded, seat.holeCards, community]
  );
  const select = onSelect ? () => onSelect(seat.seatIndex, seat.userId, seat.name) : undefined;
  return (
    <div
      onClick={select}
      onKeyDown={(e) => { if (select && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); select(); } }}
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      aria-label={onSelect ? `آمار ${seat.name ?? "بازیکن"}` : undefined}
      className={`seat-view${folded ? " seat-view--folded" : ""}${onSelect ? " seat-view--clickable" : ""}${isViewer ? " seat-view--viewer" : ""}`}
    >
      {handName && <div className="seat-hand-badge">{handName}</div>}
      {showdown && seat.holeCards?.length && seat.tagline ? (
        <div className="seat-tagline">“{seat.tagline}”</div>
      ) : null}
      <div className="seat-cards">
        {seat.holeCards?.length ? seat.holeCards.map((c, i) => <PlayingCard key={i} card={c} small />) :
          seat.hasCards ? [0, 1].map((i) => <PlayingCard key={i} small hidden cardBack={seat.cardBack} />) : null}
      </div>
      {seat.betThisRound > 0 && (
        <div
          className="seat-bet seat-bet--felt"
          style={chipOffset ? { transform: `translate(${chipOffset.x}px, ${chipOffset.y}px)` } : undefined}
        >
          <ChipStack amount={seat.betThisRound} compact={compact} maxChips={3} />
        </div>
      )}
      {seat.stack > 0 && (
        <div
          className="seat-felt-chips"
          style={{
            ...(chipOffset ? { transform: `translate(${chipOffset.x * 1.35}px, ${chipOffset.y * 1.35}px)` } : {}),
            ...(seat.chipColor ? ({ "--seat-chip": seat.chipColor } as React.CSSProperties) : {}),
          }}
        >
          <ChipStack amount={seat.stack} compact={compact} showAmount maxChips={compact ? 2 : 3} />
        </div>
      )}
      <div className="seat-row">
        <div className={`panel seat-panel${isTurn ? " seat-panel--turn" : ""}`}>
          <div className="seat-name">
            {isButton ? "🅑 " : ""}{seat.name}{!seat.isConnected ? " ⚠" : ""}
          </div>
          {seat.title && <div className="seat-title">«{seat.title}»</div>}
          {seat.status === "allin" && <div className="seat-tag-allin">آل‌این</div>}
          {seat.sitOut && <div className="seat-tag-sitout">سیت‌اوت</div>}
          {isTurn && deadline && <Countdown deadline={deadline} />}
        </div>
        <PlayerAvatar
          avatar={seat.avatar}
          userId={seat.userId ?? undefined}
          name={seat.name ?? undefined}
          size={compact ? 35 : 44}
          className={isTurn ? "player-avatar--turn" : ""}
        />
      </div>
    </div>
  );
}, seatViewEqual);

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
  return <div className="seat-countdown">{left ?? "•"}</div>;
}

function ChatPanel({ compact, log, myId, muteAll, mutedUsers, emotes, onToggleMuteAll, onToggleMuteUser, onSend }: {
  compact?: boolean;
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
  const [open, setOpen] = useState(() => !compact);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Collapse the feed on the transition INTO compact (small/landscape) layout.
  // Done at render time rather than in an effect — same "adjust state on prop
  // change" pattern used by ActionBar — to avoid a cascading extra render.
  const [prevCompact, setPrevCompact] = useState(compact);
  if (compact !== prevCompact) {
    setPrevCompact(compact);
    if (compact) setOpen(false);
  }

  const collapsed = !open;

  // Hide muted players' chat/all-in lines; table events always show. Memoised so
  // this only re-runs when the log or mute prefs change, not on every render
  // (e.g. typing in the compose box, which updates local `text` state).
  const recent = useMemo(() => {
    const visible = log.filter((e) => {
      if (e.kind !== "chat" && e.kind !== "allin") return true;
      const uid = e.author?.userId;
      if (!uid || uid === myId) return true;
      if (muteAll) return false;
      return !mutedUsers.has(uid);
    });
    return visible.slice(-40);
  }, [log, myId, muteAll, mutedUsers]);
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
    <div className={`panel chat-panel${collapsed ? " chat-panel--collapsed" : ""}${compact ? " chat-panel--compact" : ""}`}>
      <div
        className="chat-panel-head"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((o) => !o); } }}
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        aria-controls="chat-panel-body"
      >
        <span className="chat-panel-title chat-panel-toggle">
          <span className="chat-panel-chevron" aria-hidden>{collapsed ? "▲" : "▼"}</span>
          گفتگو و رویدادها
        </span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleMuteAll(); }}
          className="btn btn-ghost chat-panel-mute"
        >
          {muteAll ? (compact ? "🔕" : "🔕 صدای همه بسته") : (compact ? "🔔" : "🔔 صدای چت باز")}
        </button>
      </div>
      <div id="chat-panel-body" className="chat-panel-body">
      <div ref={scrollRef} className="chat-scroll">
        {recent.map((e) => {
          const mine = e.author?.userId && e.author.userId === myId;
          if (e.kind === "chat") {
            return (
              <div key={e.id} className="chat-msg">
                <b className={mine ? "chat-msg-author--mine" : "chat-msg-author--other"}>{e.author?.name ?? "?"}:</b> {e.text}
                {!mine && e.author?.userId && (
                  <button onClick={() => onToggleMuteUser(e.author!.userId)} title="میوت این بازیکن"
                    className={`chat-msg-mute${mutedUsers.has(e.author.userId) ? " chat-msg-mute--active" : ""}`}>
                    {mutedUsers.has(e.author.userId) ? "🔇" : "🔈"}
                  </button>
                )}
              </div>
            );
          }
          if (e.kind === "allin") {
            return <div key={e.id} className="chat-msg-allin">⚡ {e.text}</div>;
          }
          return (
            <div key={e.id} className="chat-msg-event">
              <span className="chat-msg-time">{new Date(e.ts).toLocaleTimeString("fa", { hour: "2-digit", minute: "2-digit" })}</span>
              {" — "}{e.text}
            </div>
          );
        })}
      </div>
      {showPresets && (
        <div className="chat-chip-row">
          {QUICK_CHAT.map((q) => (
            <button key={q} onClick={() => send(q)} className="btn btn-ghost chat-chip-btn">{q}</button>
          ))}
        </div>
      )}
      {emotes.length > 0 && (
        <div className="chat-chip-row">
          {emotes.map((e) => (
            <button key={e} onClick={() => onSend(e)} className="chat-emote-btn">{e}</button>
          ))}
        </div>
      )}
      <div className="chat-compose">
        <button onClick={() => setShowPresets((s) => !s)} className="btn btn-ghost chat-compose-presets" title="جملات آماده">💬</button>
        <Input
          className="chat-compose-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(text); }}
          maxLength={200}
          placeholder="پیام…"
        />
        <button onClick={() => send(text)} className="btn btn-primary chat-compose-send">ارسال</button>
      </div>
      </div>
    </div>
  );
}

/** Brief full-width flash whenever a new all-in is announced in the feed.
 *  Keyed by the entry id so the CSS animation replays only on a NEW all-in
 *  (React remounts on key change) — no timers or state, so it's lint-clean. */
function AllInFlash({ log }: { log: LogEntry[] }) {
  const lastAllIn = log.findLast((e) => e.kind === "allin");
  if (!lastAllIn) return null;
  return (
    <div key={lastAllIn.id} className="allin-flash">
      <div className="allin-flash-text">
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
    <div className="panel show-cards-prompt">
      <span className="show-cards-prompt-text">می‌خواهی کارت‌هایت را نشان دهی؟</span>
      <button className="btn btn-gold action-btn-sm" onClick={onShow}>
        نمایش کارت‌هایم{left !== null ? ` (${left.toLocaleString("fa")})` : ""}
      </button>
    </div>
  );
}

function ActionBar({ compact, state, mySeat, act, topup, leaveSeat, preAction, onPreAction, sitOut, requestExtraTime, isTournament, onForfeit }: {
  compact?: boolean;
  state: PublicGameState; mySeat: SeatVM;
  act: (a: PlayerAction) => void; topup: (n: number) => void; leaveSeat: () => void;
  preAction: PreAction | null; onPreAction: (t: PreAction) => void;
  sitOut: (out: boolean) => void; requestExtraTime: () => void;
  isTournament?: boolean; onForfeit?: () => void;
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
    <div className={`panel action-bar${myTurn ? " action-bar--turn" : ""}`}>
      {myTurn ? (
        <>
          <div className="action-row action-row--betting">
            <button className="btn btn-danger action-btn-flex" onClick={() => act({ type: "fold" })}>فولد</button>
            {toCall === 0 ? (
              <button className="btn btn-ghost action-btn-flex" onClick={() => act({ type: "check" })}>چک</button>
            ) : (
              <button className="btn btn-primary action-btn-flex" onClick={() => act({ type: "call" })}>
                کال {toCall.toLocaleString("fa")}
              </button>
            )}
            <button className="btn btn-gold action-btn-flex" disabled={!canRaise}
              onClick={() => act(raiseTo >= maxTo ? { type: "allin" } : { type: state.currentBet > 0 ? "raise" : "bet", amount: raiseTo })}>
              {state.currentBet > 0 ? "رِیز" : "بِت"} {raiseTo.toLocaleString("fa")}
            </button>
          </div>
          {canRaise && (
            <div className="action-raise-row">
              <input type="range" className="action-raise-slider" min={minRaiseTo} max={maxTo} value={raiseTo} step={state.config.smallBlind}
                onChange={(e) => setRaiseTo(Number(e.target.value))} aria-label="مبلغ رِیز" />
              <button className="btn btn-ghost action-btn-sm action-allin-btn" onClick={() => setRaiseTo(maxTo)}>آل‌این</button>
            </div>
          )}
          {canExtraTime && (
            <button className="btn btn-ghost action-extra-time" onClick={requestExtraTime}>
              {compact
                ? `⏱ +${state.config.extraTimeSec.toLocaleString("fa")}ث`
                : `⏱ زمان اضافه (+${state.config.extraTimeSec.toLocaleString("fa")} ثانیه)`}
            </button>
          )}
        </>
      ) : (
        <div>
          {mySeat.status === "active" && ["preflop", "flop", "turn", "river"].includes(state.phase) && (
            <div className="action-pre-section">
              <div className="action-pre-label">
                <span className="action-pre-label-full">اقدام از پیش (وقتی نوبتت شد خودکار اجرا می‌شود)</span>
                <span className="action-pre-label-short">اقدام از پیش</span>
              </div>
              <div className="action-row action-row--pre">
                <button className={`btn action-btn-flex action-btn-sm ${preAction === "fold" ? "btn-danger" : "btn-ghost"}`} onClick={() => onPreAction("fold")}>فولد</button>
                <button className={`btn action-btn-flex action-btn-sm ${preAction === "check_fold" ? "btn-gold" : "btn-ghost"}`} onClick={() => onPreAction("check_fold")}>چ/ف</button>
                <button className={`btn action-btn-flex action-btn-sm ${preAction === "check" ? "btn-primary" : "btn-ghost"}`} onClick={() => onPreAction("check")}>چک</button>
              </div>
            </div>
          )}
          <div className="action-wait-row">
            <div className="action-stack-label">
              موجودی میز: <b className="action-stack-value">{mySeat.stack.toLocaleString("fa")}</b>
            </div>
            <div className="action-controls">
              {!isTournament && (
                <button className={`btn action-btn-sm ${mySeat.sitOut ? "btn-primary" : "btn-ghost"}`} onClick={() => sitOut(!mySeat.sitOut)}>
                  {mySeat.sitOut ? "بازگشت به بازی" : "سیت‌اوت"}
                </button>
              )}
              {!isTournament && state.config.allowTopUp && (
                <button className="btn btn-gold action-btn-sm" onClick={() => setShowTopup((s) => !s)}>+ تاپ‌آپ</button>
              )}
              {isTournament ? (
                <button className="btn btn-danger action-btn-sm" onClick={onForfeit}>انصراف از تورنومنت</button>
              ) : (
                <button className="btn btn-ghost action-btn-sm" onClick={leaveSeat}>خروج از میز</button>
              )}
            </div>
          </div>
        </div>
      )}

      {showTopup && !isTournament && (
        <div className="action-topup-row">
          <Input type="number" className="action-topup-input" value={topupAmt} onChange={(e) => setTopupAmt(Number(e.target.value))} />
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

function StatChip({ label, value, tone = "default" }: { label: string; value: string; tone?: "gold" | "accent" | "danger" | "default" }) {
  return (
    <div className={`stats-chip stats-chip--${tone}`}>
      <span className="stats-chip-label">{label}</span>
      <span className="stats-chip-value">{value}</span>
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

  const displayName = stats?.displayName ?? name;
  const profile = stats?.profile;
  const hasProfile = profile && (profile.avatar || profile.title || profile.tagline || profile.favoriteCards.length > 0);
  const statsVisible = stats && stats.statsPublic !== false && stats.handsPlayed !== undefined;
  const net = stats?.net ?? 0;

  return (
    <Modal
      className="player-stats-modal"
      title={displayName}
      subtitle="آمار این بازیکن در این میز"
      onClose={onClose}
      titleId="player-stats-title"
    >
      {hasProfile && (
        <div className="stats-card-hero">
          <div className="stats-card-hero-inner">
            {profile!.avatar && (
              <div className="stats-card-avatar" aria-hidden>
                <PlayerAvatar avatar={profile!.avatar} userId={userId} name={displayName} size={56} />
              </div>
            )}
            <div className="stats-card-identity">
              {profile!.title && <div className="stats-card-title">«{profile!.title}»</div>}
              {profile!.tagline && <div className="stats-card-tagline">“{profile!.tagline}”</div>}
            </div>
            {profile!.favoriteCards.length > 0 && (
              <div className="stats-card-hole">
                {profile!.favoriteCards.map((c, i) => (
                  <div key={c} className="stats-card-hole-card" style={{ "--hole-i": i } as React.CSSProperties}>
                    <PlayingCard card={stringToCard(c)} small />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {err && <p className="login-error stats-card-error">{err}</p>}
      {!stats && !err && (
        <div className="stats-card-loading" aria-busy="true">
          <span className="stats-card-loading-chip" aria-hidden />
          <span>در حال بارگذاری آمار…</span>
        </div>
      )}
      {stats && stats.statsPublic === false && (
        <div className="stats-card-private">
          <span className="stats-card-private-icon" aria-hidden>🔒</span>
          <p>این بازیکن آمار خود را خصوصی کرده است.</p>
        </div>
      )}

      {statsVisible && (
        <>
          <div className="stats-highlight-row">
            <StatChip
              label="درصد برد"
              value={`${(stats.winRate ?? 0).toLocaleString("fa")}٪`}
              tone="gold"
            />
            <StatChip
              label="سود/زیان"
              value={`${net >= 0 ? "+" : ""}${net.toLocaleString("fa")}`}
              tone={net >= 0 ? "accent" : "danger"}
            />
          </div>
          <div className="stats-detail-grid">
            <StatChip
              label="دست برنده"
              value={(stats.handsWon ?? 0).toLocaleString("fa")}
            />
            <StatChip
              label="کل دست‌ها"
              value={(stats.handsPlayed ?? 0).toLocaleString("fa")}
            />
            <StatChip
              label="ژتون خریداری‌شده"
              value={(stats.totalBought ?? 0).toLocaleString("fa")}
              tone="accent"
            />
            <StatChip
              label="دفعات خرید"
              value={(stats.buyInCount ?? 0).toLocaleString("fa")}
            />
          </div>
        </>
      )}

      <div className="stats-card-actions">
        <Link href={`/u/${userId}`} className="btn btn-ghost stats-profile-link">
          <span className="stats-profile-link-icon" aria-hidden>♠</span>
          پروفایل کامل و افتخارات
        </Link>
        {canKick && onKick && (
          <button
            type="button"
            className="btn btn-danger stats-kick-btn"
            onClick={() => { if (confirm(`${name} از میز حذف شود؟`)) onKick(); }}
          >
            حذف از میز
          </button>
        )}
      </div>
    </Modal>
  );
}

function ForfeitTournamentModal({ stack, onCancel, onConfirm }: {
  stack: number; onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <Modal
      title="انصراف از تورنومنت"
      subtitle="این عمل قابل بازگشت نیست"
      onClose={onCancel}
      titleId="forfeit-tournament-title"
      className="forfeit-tournament-modal"
    >
      <p className="forfeit-tournament-desc">
        با انصراف، از تورنومنت حذف می‌شوید و رتبه‌تان ثبت می‌شود.
        {stack > 0
          ? ` ژتون‌های روی میز (${stack.toLocaleString("fa")}) به‌صورت متناسب با استک باقی‌مانده بازیکنان دیگر تقسیم می‌شود و به حساب بانکی شما برنمی‌گردد.`
          : " ژتون روی میز ندارید."}
      </p>
      <p className="forfeit-tournament-hint">فقط بین دست‌ها می‌توانید انصراف دهید.</p>
      <div className="forfeit-tournament-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>ادامه بازی</button>
        <button type="button" className="btn btn-danger" onClick={onConfirm}>تأیید انصراف</button>
      </div>
    </Modal>
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
    <Modal
      title={`نشستن روی صندلی ${(seat + 1).toLocaleString("fa")}`}
      subtitle={`موجودی ژتون شما: ${balance.toLocaleString("fa")} · ورود مجاز ${config.minBuyIn.toLocaleString("fa")}–${config.maxBuyIn.toLocaleString("fa")}`}
      onClose={onCancel}
      titleId="sit-dialog-title"
    >
      {insufficient ? (
        <p className="login-error">موجودی شما برای ورود کافی نیست. از مدیر ژتون بخواهید.</p>
      ) : (
        <>
          <input type="range" className="sit-dialog-range" min={config.minBuyIn} max={maxAllowed} step={config.bigBlind} value={buyIn}
            onChange={(e) => setBuyIn(Number(e.target.value))} />
          <div className="sit-dialog-amount">{buyIn.toLocaleString("fa")} ژتون</div>
        </>
      )}
      <div className="sit-dialog-actions">
        <button className="btn btn-ghost" onClick={onCancel}>انصراف</button>
        <button className="btn btn-primary" disabled={insufficient} onClick={() => onSit(buyIn)}>نشستن</button>
      </div>
    </Modal>
  );
}
