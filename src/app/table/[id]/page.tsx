"use client";
import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTableSocket } from "@/components/useTableSocket";
import { PlayingCard } from "@/components/PlayingCard";
import { fetchMe, type Me } from "@/lib/client/api";
import type { PublicGameState, PlayerAction, TableConfig } from "@/lib/poker/types";

type SeatVM = PublicGameState["seats"][number];

const PHASE_FA: Record<string, string> = {
  waiting: "در انتظار بازیکنان", preflop: "پیش‌فلاپ", flop: "فلاپ", turn: "ترن",
  river: "ریور", showdown: "رو کردن", hand_complete: "پایان دست",
};

export default function TablePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { state, connected, error, clearError, sit, leaveSeat, act, topup } = useTableSocket(id);
  const [me, setMe] = useState<Me | null>(null);
  const [sitSeat, setSitSeat] = useState<number | null>(null);

  useEffect(() => { fetchMe().then((u) => (u ? setMe(u) : router.replace("/login"))); }, [router]);

  const seatCount = state?.config.maxSeats ?? 6;
  const viewerSeat = state?.viewerSeat ?? null;
  const mySeat = viewerSeat != null ? state?.seats[viewerSeat] : undefined;

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
        <div style={{ fontSize: 12, color: connected ? "var(--accent)" : "var(--danger)" }}>{connected ? "متصل" : "قطع"}</div>
      </header>

      {/* Felt */}
      <div style={{ position: "relative", flex: 1, minHeight: 420, margin: "8px 0" }}>
        <div style={{
          position: "absolute", inset: "6% 3%", borderRadius: "48%/40%",
          background: "radial-gradient(120% 120% at 50% 30%, var(--felt-2), var(--felt) 60%, #06281d)",
          border: "8px solid #5b3b1e", boxShadow: "inset 0 0 60px rgba(0,0,0,.5), 0 10px 30px rgba(0,0,0,.4)",
        }} />
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
                <SeatView seat={seat!} isTurn={isTurn} isButton={isButton} deadline={isTurn ? state?.actionDeadline : undefined} />
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

      {error && (
        <div onClick={clearError} className="panel" style={{ padding: "0.6rem 1rem", marginBottom: 8, borderColor: "var(--danger)", color: "var(--danger)", cursor: "pointer" }}>
          {error} <span style={{ float: "left", opacity: 0.6 }}>✕</span>
        </div>
      )}

      {/* Controls */}
      {mySeat ? (
        <ActionBar state={state!} mySeat={mySeat} act={act} topup={topup} leaveSeat={leaveSeat} />
      ) : (
        <div className="panel" style={{ padding: 12, textAlign: "center", color: "var(--muted)" }}>
          برای بازی روی یک صندلی خالی بزنید و بنشینید.
        </div>
      )}

      {sitSeat != null && state && me && (
        <SitDialog seat={sitSeat} config={state.config} balance={me.chipBalance}
          onCancel={() => setSitSeat(null)}
          onSit={(buyIn) => { sit(sitSeat, buyIn); setSitSeat(null); }} />
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

function SeatView({ seat, isTurn, isButton, deadline }: {
  seat: SeatVM; isTurn: boolean; isButton: boolean; deadline?: number;
}) {
  const folded = seat.status === "folded";
  return (
    <div style={{ textAlign: "center", opacity: folded ? 0.45 : 1 }}>
      {seat.betThisRound > 0 && (
        <div style={{ color: "var(--gold)", fontSize: 12, marginBottom: 2 }}>شرط: {seat.betThisRound.toLocaleString("fa")}</div>
      )}
      <div style={{ display: "flex", justifyContent: "center", gap: 3, marginBottom: 3, minHeight: 48 }}>
        {seat.holeCards?.length ? seat.holeCards.map((c, i) => <PlayingCard key={i} card={c} small />) :
          seat.hasCards ? [0, 1].map((i) => <PlayingCard key={i} small hidden />) : null}
      </div>
      <div className="panel" style={{
        padding: "5px 6px", borderColor: isTurn ? "var(--gold)" : undefined,
        boxShadow: isTurn ? "0 0 0 2px var(--gold)" : undefined, position: "relative",
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {isButton ? "🅑 " : ""}{seat.name}{!seat.isConnected ? " ⚠" : ""}
        </div>
        <div style={{ fontSize: 12, color: "var(--accent)" }}>{seat.stack.toLocaleString("fa")}</div>
        {seat.status === "allin" && <div style={{ fontSize: 10, color: "var(--danger)" }}>آل‌این</div>}
        {isTurn && deadline && <Countdown deadline={deadline} />}
      </div>
    </div>
  );
}

function Countdown({ deadline }: { deadline: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 400); return () => clearInterval(t); }, []);
  const left = Math.max(0, Math.ceil((deadline - now) / 1000));
  return <div style={{ position: "absolute", top: -6, left: -6, background: "var(--gold)", color: "#2a1e00", borderRadius: 10, fontSize: 11, fontWeight: 800, padding: "1px 6px" }}>{left}</div>;
}

function ActionBar({ state, mySeat, act, topup, leaveSeat }: {
  state: PublicGameState; mySeat: SeatVM;
  act: (a: PlayerAction) => void; topup: (n: number) => void; leaveSeat: () => void;
}) {
  const myTurn = state.currentTurnSeat === mySeat.seatIndex && ["preflop", "flop", "turn", "river"].includes(state.phase);
  const toCall = Math.max(0, state.currentBet - mySeat.betThisRound);
  const maxTo = mySeat.betThisRound + mySeat.stack;
  const minRaiseTo = Math.min(maxTo, state.currentBet > 0 ? state.currentBet + state.minRaise : state.config.bigBlind);
  const [raiseTo, setRaiseTo] = useState(minRaiseTo);
  useEffect(() => { setRaiseTo(minRaiseTo); }, [minRaiseTo, state.handNo, state.phase, state.currentBet]);

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
        </>
      ) : (
        <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>
            موجودی میز: <b style={{ color: "var(--accent)" }}>{mySeat.stack.toLocaleString("fa")}</b>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {state.config.allowTopUp && (
              <button className="btn btn-gold" style={{ fontSize: 13 }} onClick={() => setShowTopup((s) => !s)}>+ تاپ‌آپ</button>
            )}
            <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={leaveSeat}>خروج از میز</button>
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
