"use client";
import { use, useCallback, useEffect, useRef, useState, memo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTableSocket } from "@/components/useTableSocket";
import { useTableSounds } from "@/components/useTableSounds";
import { DealerAvatar } from "@/components/DealerAvatar";
import { PlayingCard } from "@/components/PlayingCard";
import { api, fetchMe, type Me } from "@/lib/client/api";
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
  const { state, tourney, connected, error, clearError, sit, leaveSeat, act, topup, showCards, sitOut, requestExtraTime, kick, rebuy, chat } = useTableSocket(id);
  const [me, setMe] = useState<Me | null>(null);
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

  const compact = useCompactLayout();

  return (
    <PageShell table>
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

      <div className="table-felt-wrap">
        <div className="table-felt" />
        <div className="table-dealer-anchor">
          <DealerAvatar size={56} />
        </div>
        <div className="table-center">
          <div className="table-pot">پات: {(state?.pot ?? 0).toLocaleString("fa")}</div>
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
          const pos = seatPosition(i, viewerSeat, seatCount, compact);
          const seat = state?.seats[i];
          const isTurn = state?.currentTurnSeat === i;
          const isButton = state?.buttonSeat === i && state?.phase !== "waiting";
          const occupied = seat && seat.status !== "empty";
          return (
            <div key={i} className="table-seat-slot" style={{ left: `${pos.x}%`, top: `${pos.y}%` }}>
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
                <button className="btn btn-ghost seat-empty-btn"
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
        <div onClick={clearError} className="panel table-error-banner" role="alert">
          {error} <span className="table-error-dismiss">✕</span>
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
        <div className="panel table-hint-panel">
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
    </PageShell>
  );
}

function useCompactLayout() {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 520px)");
    const update = () => setCompact(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return compact;
}

function seatPosition(index: number, viewerSeat: number | null, n: number, compact = false) {
  const anchor = viewerSeat ?? 0;
  const displayPos = ((index - anchor) % n + n) % n;
  const theta = Math.PI / 2 + (displayPos * 2 * Math.PI) / n;
  const rx = compact ? 40 : 44;
  const ry = compact ? 38 : 43;
  return { x: 50 + rx * Math.cos(theta), y: 50 + ry * Math.sin(theta) };
}

const SeatView = memo(function SeatView({ seat, isTurn, isButton, community, deadline, showdown, onSelect }: {
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
      className={`seat-view${folded ? " seat-view--folded" : ""}${onSelect ? " seat-view--clickable" : ""}`}
    >
      {seat.betThisRound > 0 && (
        <div className="seat-bet">شرط: {seat.betThisRound.toLocaleString("fa")}</div>
      )}
      {handName && <div className="seat-hand-badge">{handName}</div>}
      {showdown && seat.holeCards?.length && seat.tagline ? (
        <div className="seat-tagline">“{seat.tagline}”</div>
      ) : null}
      <div className="seat-cards">
        {seat.holeCards?.length ? seat.holeCards.map((c, i) => <PlayingCard key={i} card={c} small />) :
          seat.hasCards ? [0, 1].map((i) => <PlayingCard key={i} small hidden />) : null}
      </div>
      <div className={`panel seat-panel${isTurn ? " seat-panel--turn" : ""}`}>
        <div className="seat-name">
          {isButton ? "🅑 " : ""}{seat.avatar ? `${seat.avatar} ` : ""}{seat.name}{!seat.isConnected ? " ⚠" : ""}
        </div>
        {seat.title && <div className="seat-title">«{seat.title}»</div>}
        <div className="seat-stack" style={{ color: seat.chipColor || "var(--accent)" }}>{seat.stack.toLocaleString("fa")}</div>
        {seat.status === "allin" && <div className="seat-tag-allin">آل‌این</div>}
        {seat.sitOut && <div className="seat-tag-sitout">سیت‌اوت</div>}
        {isTurn && deadline && <Countdown deadline={deadline} />}
      </div>
    </div>
  );
});

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
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 520px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const collapsed = isMobile && !mobileOpen;

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
    <div className={`panel chat-panel${collapsed ? " chat-panel--collapsed" : ""}`}>
      <div
        className="chat-panel-head"
        onClick={isMobile ? () => setMobileOpen((o) => !o) : undefined}
        onKeyDown={isMobile ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setMobileOpen((o) => !o); } } : undefined}
        role={isMobile ? "button" : undefined}
        tabIndex={isMobile ? 0 : undefined}
        aria-expanded={isMobile ? !collapsed : undefined}
      >
        <span className="chat-panel-title chat-panel-toggle">
          {collapsed ? "💬 گفتگو و رویدادها" : "گفتگو و رویدادها"}
        </span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleMuteAll(); }}
          className="btn btn-ghost chat-panel-mute"
        >
          {muteAll ? (isMobile ? "🔕" : "🔕 صدای همه بسته") : (isMobile ? "🔔" : "🔔 صدای چت باز")}
        </button>
      </div>
      <div className="chat-panel-body">
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
  const lastAllIn = [...log].reverse().find((e) => e.kind === "allin");
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
    <div className="panel action-bar">
      {myTurn ? (
        <>
          <div className="action-row">
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
                onChange={(e) => setRaiseTo(Number(e.target.value))} />
              <button className="btn btn-ghost action-btn-sm" onClick={() => setRaiseTo(maxTo)}>آل‌این</button>
            </div>
          )}
          {canExtraTime && (
            <button className="btn btn-ghost action-extra-time" onClick={requestExtraTime}>
              ⏱ زمان اضافه (+{state.config.extraTimeSec.toLocaleString("fa")} ثانیه)
            </button>
          )}
        </>
      ) : (
        <div>
          {mySeat.status === "active" && ["preflop", "flop", "turn", "river"].includes(state.phase) && (
            <div className="action-pre-section">
              <div className="action-pre-label">اقدام از پیش (وقتی نوبتت شد خودکار اجرا می‌شود)</div>
              <div className="action-row">
                <button className={`btn action-btn-flex action-btn-sm ${preAction === "fold" ? "btn-danger" : "btn-ghost"}`} onClick={() => onPreAction("fold")}>فولد خودکار</button>
                <button className={`btn action-btn-flex action-btn-sm ${preAction === "check_fold" ? "btn-gold" : "btn-ghost"}`} onClick={() => onPreAction("check_fold")}>چک/فولد</button>
                <button className={`btn action-btn-flex action-btn-sm ${preAction === "check" ? "btn-primary" : "btn-ghost"}`} onClick={() => onPreAction("check")}>چک</button>
              </div>
            </div>
          )}
          <div className="action-wait-row">
            <div className="action-stack-label">
              موجودی میز: <b className="action-stack-value">{mySeat.stack.toLocaleString("fa")}</b>
            </div>
            <div className="action-controls">
              <button className={`btn action-btn-sm ${mySeat.sitOut ? "btn-primary" : "btn-ghost"}`} onClick={() => sitOut(!mySeat.sitOut)}>
                {mySeat.sitOut ? "بازگشت به بازی" : "سیت‌اوت"}
              </button>
              {state.config.allowTopUp && (
                <button className="btn btn-gold action-btn-sm" onClick={() => setShowTopup((s) => !s)}>+ تاپ‌آپ</button>
              )}
              <button className="btn btn-ghost action-btn-sm" onClick={leaveSeat}>خروج از میز</button>
            </div>
          </div>
        </div>
      )}

      {showTopup && (
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
function StatRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="stat-row">
      <span className="stat-row-label">{label}</span>
      <b style={color ? { color } : undefined}>{value}</b>
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
    <Modal title={`📊 آمار ${stats?.displayName ?? name}`} onClose={onClose} titleId="player-stats-title">
      {stats?.profile && (stats.profile.avatar || stats.profile.title || stats.profile.tagline || stats.profile.favoriteCards.length > 0) && (
        <div className="stats-hero">
          {stats.profile.avatar && <div className="stats-hero-avatar">{stats.profile.avatar}</div>}
          <div className="stats-hero-body">
            {stats.profile.title && <div className="stats-hero-title">«{stats.profile.title}»</div>}
            {stats.profile.tagline && <div className="stats-hero-tagline">“{stats.profile.tagline}”</div>}
          </div>
          <div className="stats-hero-cards">
            {stats.profile.favoriteCards.map((c) => <PlayingCard key={c} card={stringToCard(c)} small />)}
          </div>
        </div>
      )}
      <div className="info-cell-label stats-section-label">آمار این بازیکن در این میز</div>
      {err && <p className="login-error">{err}</p>}
      {!stats && !err && <p className="empty-state-desc">در حال بارگذاری…</p>}
      {stats && stats.statsPublic === false && (
        <p className="empty-state-desc">این بازیکن آمار خود را خصوصی کرده است.</p>
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
      <Link href={`/u/${userId}`} className="btn btn-ghost stats-profile-link">
        پروفایل کامل و افتخارات →
      </Link>
      {canKick && onKick && (
        <button className="btn btn-danger stats-kick-btn"
          onClick={() => { if (confirm(`${name} از میز حذف شود؟`)) onKick(); }}>
          حذف از میز (کیک)
        </button>
      )}
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
