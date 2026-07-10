"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, fetchMe, type Me } from "@/lib/client/api";
import { Input, Field, Modal, LoadingScreen } from "@/components/ui";

interface TableSummary {
  id: string;
  name: string;
  config: { smallBlind: number; bigBlind: number; minBuyIn: number; maxBuyIn: number };
  seated: number;
  maxSeats: number;
}

const STAKES = [
  { id: "low", label: "آرام", blinds: "۵/۱۰", sb: 5, bb: 10, minBuyIn: 200, maxBuyIn: 2000 },
  { id: "mid", label: "معمولی", blinds: "۱۰/۲۰", sb: 10, bb: 20, minBuyIn: 400, maxBuyIn: 4000 },
  { id: "high", label: "تند", blinds: "۲۵/۵۰", sb: 25, bb: 50, minBuyIn: 1000, maxBuyIn: 10000 },
] as const;

function SeatDots({ seated, max }: { seated: number; max: number }) {
  return (
    <div className="seat-dots" aria-label={`${seated} از ${max} صندلی پر`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={`seat-dot${i < seated ? " seat-dot--filled" : ""}`} />
      ))}
    </div>
  );
}

export default function LobbyPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [tables, setTables] = useState<TableSummary[]>([]);
  const [tab, setTab] = useState<"tables" | "tournaments">("tables");
  const [showCreateTable, setShowCreateTable] = useState(false);
  const [showCreateTournament, setShowCreateTournament] = useState(false);
  const [tournamentRefresh, setTournamentRefresh] = useState(0);

  const load = useCallback(async () => {
    const { tables } = await api<{ tables: TableSummary[] }>("/api/tables");
    setTables(tables);
  }, []);

  const refreshMe = useCallback(async () => {
    const u = await fetchMe();
    if (u) setMe(u);
  }, []);

  useEffect(() => {
    fetchMe().then((u) => {
      if (!u) return router.replace("/login");
      setMe(u);
      load();
    });
  }, [router, load]);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  if (!me) return <LoadingScreen message="در حال بارگذاری لابی…" />;

  const isAdmin = me.role === "admin";

  return (
    <>
      <main className="lobby">
      <header className="lobby-header">
        <div className="lobby-brand">
          <span className="lobby-logo" aria-hidden>♠</span>
          <div>
            <h1 className="lobby-title">Plazza</h1>
            <p className="lobby-subtitle">خوش آمدید، {me.displayName}</p>
          </div>
        </div>
        <div className="lobby-wallet">
          <span className="lobby-wallet-label">موجودی ژتون</span>
          <span className="lobby-wallet-amount">{me.chipBalance.toLocaleString("fa")}</span>
        </div>
      </header>

      <nav className="lobby-nav" aria-label="منوی حساب">
        <Link href="/profile" className="btn btn-ghost">پروفایل</Link>
        <Link href="/account" className="btn btn-ghost">حساب من</Link>
        {isAdmin && <Link href="/admin" className="btn btn-gold">مدیریت</Link>}
        <button onClick={logout} className="btn btn-ghost">خروج</button>
      </nav>

      <div className="lobby-tabs" role="tablist" aria-label="بخش‌های لابی">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "tables"}
          className={`lobby-tab${tab === "tables" ? " lobby-tab--active" : ""}`}
          onClick={() => setTab("tables")}
        >
          میزها ({tables.length.toLocaleString("fa")})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "tournaments"}
          className={`lobby-tab${tab === "tournaments" ? " lobby-tab--active" : ""}`}
          onClick={() => setTab("tournaments")}
        >
          تورنومنت‌ها
        </button>
      </div>

      {tab === "tables" && (
        <section className="lobby-section" aria-labelledby="tables-heading">
          {isAdmin && (
            <button type="button" className="lobby-fab" onClick={() => setShowCreateTable(true)}>
              <span aria-hidden>＋</span>
              ساخت میز جدید
            </button>
          )}

          <div className="lobby-grid">
            {tables.length === 0 && (
              <div className="panel empty-state">
                <div className="empty-state-icon" aria-hidden>🃏</div>
                <p className="empty-state-title">هنوز میزی باز نیست</p>
                <p className="empty-state-desc">
                  {isAdmin
                    ? "روی «ساخت میز جدید» بزنید — فقط چند ثانیه طول می‌کشد."
                    : "به‌زودی میز جدیدی اضافه می‌شود."}
                </p>
                {isAdmin && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ marginTop: "0.85rem" }}
                    onClick={() => setShowCreateTable(true)}
                  >
                    ساخت اولین میز
                  </button>
                )}
              </div>
            )}
            {tables.map((t) => (
              <Link key={t.id} href={`/table/${t.id}`} className="panel table-card">
                <div>
                  <div className="table-card-name">{t.name}</div>
                  <div className="table-card-meta">
                    <span className="meta-pill meta-pill--gold">
                      بلایند {t.config.smallBlind.toLocaleString("fa")}/{t.config.bigBlind.toLocaleString("fa")}
                    </span>
                    <span className="meta-pill">
                      ورود {t.config.minBuyIn.toLocaleString("fa")}–{t.config.maxBuyIn.toLocaleString("fa")}
                    </span>
                  </div>
                </div>
                <div className="table-card-side">
                  <SeatDots seated={t.seated} max={t.maxSeats} />
                  <span className="table-card-enter">
                    ورود
                    <span aria-hidden>←</span>
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {tab === "tournaments" && (
        <TournamentsSection
          isAdmin={isAdmin}
          onBalanceChange={refreshMe}
          onCreateClick={() => setShowCreateTournament(true)}
          refreshToken={tournamentRefresh}
        />
      )}
      </main>

      {showCreateTable && (
        <CreateTableModal
          onClose={() => setShowCreateTable(false)}
          onDone={() => { setShowCreateTable(false); load(); }}
        />
      )}

      {showCreateTournament && (
        <CreateTournamentModal
          onClose={() => setShowCreateTournament(false)}
          onDone={() => { setShowCreateTournament(false); setTournamentRefresh((t) => t + 1); }}
        />
      )}
    </>
  );
}

interface TournamentSummary {
  id: string; name: string; status: string; buyInChips: number; startingStack: number;
  maxPlayers: number; registered: number; prizePool: number; payouts: number[]; lateRegOpen?: boolean; registeredByMe?: boolean;
}

const STATUS_FA: Record<string, string> = {
  scheduled: "در انتظار",
  running: "در حال اجرا",
  finishing: "در حال پایان",
  finished: "پایان‌یافته",
  cancelled: "لغو",
};

function statusBadgeClass(status: string) {
  if (status === "scheduled") return "status-badge status-badge--scheduled";
  if (status === "running" || status === "finishing") return "status-badge status-badge--running";
  if (status === "cancelled") return "status-badge status-badge--cancelled";
  return "status-badge status-badge--finished";
}

const TOURNAMENT_PRESETS = [
  { id: "quick", label: "سریع", sub: "۶ نفر · ۱۰ دقیقه", buyIn: 1000, stack: 1500, maxPlayers: 6, startBigBlind: 20, levelMinutes: 10, levels: 12 },
  { id: "standard", label: "استاندارد", sub: "۹ نفر · ۱۲ دقیقه", buyIn: 2000, stack: 3000, maxPlayers: 9, startBigBlind: 25, levelMinutes: 12, levels: 15 },
  { id: "big", label: "بزرگ", sub: "۹ نفر · ۱۵ دقیقه", buyIn: 5000, stack: 8000, maxPlayers: 9, startBigBlind: 50, levelMinutes: 15, levels: 18 },
] as const;

const PAYOUT_OPTIONS = [
  { id: "", label: "خودکار" },
  { id: "winner-takes-all", label: "۱۰۰٪" },
  { id: "70-30", label: "۷۰/۳۰" },
  { id: "50-30-20", label: "۵۰/۳۰/۲۰" },
] as const;

function TournamentsSection({
  isAdmin,
  onBalanceChange,
  onCreateClick,
  refreshToken,
}: {
  isAdmin: boolean;
  onBalanceChange: () => void;
  onCreateClick: () => void;
  refreshToken: number;
}) {
  const [items, setItems] = useState<TournamentSummary[]>([]);
  const load = useCallback(() => api<{ tournaments: TournamentSummary[] }>("/api/tournaments").then((d) => setItems(d.tournaments)), []);
  useEffect(() => { load(); }, [load, refreshToken]);

  async function register(id: string) {
    try { await api(`/api/tournaments/${id}/register`, { method: "POST" }); load(); onBalanceChange(); }
    catch (e) { alert((e as Error).message); }
  }
  async function start(id: string) {
    try { await api(`/api/tournaments/${id}/start`, { method: "POST" }); load(); }
    catch (e) { alert((e as Error).message); }
  }

  return (
    <section className="lobby-section" aria-labelledby="tournaments-heading">
      {isAdmin && (
        <button type="button" className="lobby-fab lobby-fab--gold" onClick={onCreateClick}>
          <span aria-hidden>＋</span>
          ساخت تورنومنت
        </button>
      )}

      <div className="lobby-grid">
        {items.length === 0 && (
          <div className="panel empty-state">
            <div className="empty-state-icon" aria-hidden>🏆</div>
            <p className="empty-state-title">تورنومنتی برنامه‌ریزی نشده</p>
            <p className="empty-state-desc">
              {isAdmin ? "یک تورنومنت بسازید و بازیکنان را دعوت کنید." : "به‌محض شروع تورنومنت، اینجا نمایش داده می‌شود."}
            </p>
            {isAdmin && (
              <button type="button" className="btn btn-gold" style={{ marginTop: "0.85rem" }} onClick={onCreateClick}>
                ساخت اولین تورنومنت
              </button>
            )}
          </div>
        )}
        {items.map((t) => {
          const pct = t.maxPlayers > 0 ? Math.min(100, (t.registered / t.maxPlayers) * 100) : 0;
          return (
            <article key={t.id} className="panel tournament-card-v2">
              <div className="tournament-card-top">
                <div className="tournament-trophy" aria-hidden>🏆</div>
                <div className="tournament-card-body">
                  <span className={statusBadgeClass(t.status)}>{STATUS_FA[t.status] ?? t.status}</span>
                  <div className="table-card-name">{t.name}</div>
                  <div className="table-card-meta">
                    <span className="meta-pill meta-pill--gold">ورودی {t.buyInChips.toLocaleString("fa")}</span>
                    <span className="meta-pill">استک {t.startingStack.toLocaleString("fa")}</span>
                    <span className="meta-pill">جایزه {t.prizePool.toLocaleString("fa")}</span>
                  </div>
                </div>
              </div>

              <div className="tournament-progress-wrap">
                <div className="tournament-progress-label">
                  <span>ثبت‌نام</span>
                  <span>{t.registered.toLocaleString("fa")}/{t.maxPlayers.toLocaleString("fa")} نفر</span>
                </div>
                <div className="tournament-progress-bar" aria-hidden>
                  <div className="tournament-progress-fill" style={{ width: `${pct}%` }} />
                </div>
              </div>

              <div className="tournament-actions">
                {(t.status === "scheduled" || t.status === "running" || t.status === "finished") && (
                  <Link href={`/tournament/${t.id}`} className="btn btn-ghost" style={{ fontSize: 12 }}>
                    جزئیات
                  </Link>
                )}
                {t.status === "scheduled" && (
                  <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={() => register(t.id)}>
                    ثبت‌نام
                  </button>
                )}
                {t.status === "running" && t.lateRegOpen && !t.registeredByMe && (
                  <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={() => register(t.id)}>
                    ثبت‌نام با تأخیر
                  </button>
                )}
                {t.status === "scheduled" && isAdmin && (
                  <button className="btn btn-gold" style={{ fontSize: 12 }} onClick={() => start(t.id)}>
                    شروع
                  </button>
                )}
                {t.status === "running" && (
                  <Link href={`/tournament/${t.id}`} className="btn btn-primary" style={{ fontSize: 12 }}>
                    ورود
                  </Link>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function CreateTableModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [stakeId, setStakeId] = useState<(typeof STAKES)[number]["id"]>("low");
  const [name, setName] = useState("");
  const [maxSeats, setMaxSeats] = useState(6);
  const [thinkTimeSec, setThinkTimeSec] = useState(30);
  const [advanced, setAdvanced] = useState(false);
  const [ante, setAnte] = useState(0);
  const [rakePercent, setRakePercent] = useState(0);
  const [rakeCap, setRakeCap] = useState(0);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const stake = STAKES.find((s) => s.id === stakeId) ?? STAKES[0];
  const tableName = name.trim() || "میز جدید";

  async function create() {
    setErr("");
    setBusy(true);
    try {
      await api("/api/tables", {
        method: "POST",
        body: {
          name: tableName,
          smallBlind: stake.sb,
          bigBlind: stake.bb,
          minBuyIn: stake.minBuyIn,
          maxBuyIn: stake.maxBuyIn,
          maxSeats,
          thinkTimeSec,
          ante,
          rakePercent,
          rakeCap,
        },
      });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="ساخت میز جدید"
      subtitle="سه مرحله ساده — بقیه تنظیمات خودکار است"
      onClose={onClose}
      titleId="create-table-title"
    >
        <div className="create-preview">
          <span className="meta-pill meta-pill--gold">بلایند {stake.blinds}</span>
          <span className="meta-pill">ورود {stake.minBuyIn.toLocaleString("fa")}–{stake.maxBuyIn.toLocaleString("fa")}</span>
          <span className="meta-pill">{maxSeats.toLocaleString("fa")} نفره</span>
          <span className="meta-pill">{thinkTimeSec.toLocaleString("fa")}ث فکر</span>
        </div>

        <Field label="نام میز (اختیاری)" htmlFor="table-name">
          <Input id="table-name" value={name} placeholder="میز جدید" onChange={(e) => setName(e.target.value)} />
        </Field>

        <div className="ui-field">
          <div className="ui-label"><span>سطح بازی</span></div>
          <div className="stakes-grid" role="group" aria-label="سطح بلایند">
            {STAKES.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`stakes-btn${stakeId === s.id ? " stakes-btn--active" : ""}`}
                onClick={() => setStakeId(s.id)}
                aria-pressed={stakeId === s.id}
              >
                <span className="stakes-btn-label">{s.label}</span>
                <span className="stakes-btn-blinds">{s.blinds}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="ui-field">
          <div className="ui-label"><span>تعداد صندلی</span></div>
          <div className="pill-row" role="group" aria-label="تعداد صندلی">
            {[2, 6, 9].map((n) => (
              <button
                key={n}
                type="button"
                className={`pill-btn${maxSeats === n ? " pill-btn--active" : ""}`}
                onClick={() => setMaxSeats(n)}
                aria-pressed={maxSeats === n}
              >
                {n.toLocaleString("fa")} نفره
              </button>
            ))}
          </div>
        </div>

        <div className="ui-field">
          <div className="ui-label"><span>زمان فکر</span></div>
          <div className="pill-row" role="group" aria-label="زمان فکر">
            {[20, 30, 45].map((n) => (
              <button
                key={n}
                type="button"
                className={`pill-btn${thinkTimeSec === n ? " pill-btn--active" : ""}`}
                onClick={() => setThinkTimeSec(n)}
                aria-pressed={thinkTimeSec === n}
              >
                {n.toLocaleString("fa")} ثانیه
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          className="create-advanced-toggle"
          onClick={() => setAdvanced((v) => !v)}
          aria-expanded={advanced}
        >
          <span>تنظیمات پیشرفته</span>
          <span aria-hidden>{advanced ? "▲" : "▼"}</span>
        </button>

        {advanced && (
          <div className="create-advanced-grid">
            <label>آنته
              <input className="ui-input" type="number" min={0} value={ante} onChange={(e) => setAnte(Number(e.target.value))} />
            </label>
            <label>درصد rake
              <input className="ui-input" type="number" min={0} max={20} value={rakePercent} onChange={(e) => setRakePercent(Number(e.target.value))} />
            </label>
            <label>سقف rake
              <input className="ui-input" type="number" min={0} value={rakeCap} onChange={(e) => setRakeCap(Number(e.target.value))} />
            </label>
          </div>
        )}

        {err && <p className="create-error">{err}</p>}

        <button type="button" className="btn btn-primary create-submit" onClick={create} disabled={busy}>
          {busy ? "در حال ساخت…" : `ساخت «${tableName}»`}
        </button>
    </Modal>
  );
}

function CreateTournamentModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [presetId, setPresetId] = useState<(typeof TOURNAMENT_PRESETS)[number]["id"]>("quick");
  const [name, setName] = useState("");
  const [payoutPreset, setPayoutPreset] = useState<(typeof PAYOUT_OPTIONS)[number]["id"]>("");
  const [rebuyAllowed, setRebuyAllowed] = useState(true);
  const [advanced, setAdvanced] = useState(false);
  const [lateRegThroughLevel, setLateRegThroughLevel] = useState(0);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const preset = TOURNAMENT_PRESETS.find((p) => p.id === presetId) ?? TOURNAMENT_PRESETS[0];
  const tournamentName = name.trim() || "تورنومنت جدید";

  async function create() {
    setErr("");
    setBusy(true);
    try {
      await api("/api/tournaments", {
        method: "POST",
        body: {
          name: tournamentName,
          buyInChips: preset.buyIn,
          startingStack: preset.stack,
          maxPlayers: preset.maxPlayers,
          startBigBlind: preset.startBigBlind,
          levelMinutes: preset.levelMinutes,
          levels: preset.levels,
          payoutPreset: payoutPreset || undefined,
          rebuyAllowed,
          rebuyMaxCount: -1,
          rebuyThroughLevel: 4,
          lateRegThroughLevel,
          breakEveryLevels: 0,
          breakMinutes: 5,
        },
      });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="ساخت تورنومنت"
      subtitle="یک الگو انتخاب کنید — بقیه خودکار تنظیم می‌شود"
      onClose={onClose}
      titleId="create-tournament-title"
    >
        <div className="create-preview">
          <span className="meta-pill meta-pill--gold">ورودی {preset.buyIn.toLocaleString("fa")}</span>
          <span className="meta-pill">استک {preset.stack.toLocaleString("fa")}</span>
          <span className="meta-pill">{preset.maxPlayers.toLocaleString("fa")} نفره</span>
          <span className="meta-pill">بیگ‌بلایند {preset.startBigBlind.toLocaleString("fa")}</span>
        </div>

        <Field label="نام تورنومنت (اختیاری)" htmlFor="tournament-name">
          <Input id="tournament-name" value={name} placeholder="تورنومنت جدید" onChange={(e) => setName(e.target.value)} />
        </Field>

        <div className="ui-field">
          <div className="ui-label"><span>نوع تورنومنت</span></div>
          <div className="stakes-grid" role="group" aria-label="نوع تورنومنت">
            {TOURNAMENT_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`stakes-btn${presetId === p.id ? " stakes-btn--active" : ""}`}
                onClick={() => setPresetId(p.id)}
                aria-pressed={presetId === p.id}
              >
                <span className="stakes-btn-label">{p.label}</span>
                <span className="stakes-btn-blinds">{p.sub}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="ui-field">
          <div className="ui-label"><span>تقسیم جایزه</span></div>
          <div className="payout-grid" role="group" aria-label="تقسیم جایزه">
            {PAYOUT_OPTIONS.map((p) => (
              <button
                key={p.id || "auto"}
                type="button"
                className={`payout-btn${payoutPreset === p.id ? " payout-btn--active" : ""}`}
                onClick={() => setPayoutPreset(p.id)}
                aria-pressed={payoutPreset === p.id}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <label className="create-toggle-row">
          <span>ری‌بای مجاز تا سطح ۴</span>
          <input type="checkbox" checked={rebuyAllowed} onChange={(e) => setRebuyAllowed(e.target.checked)} />
        </label>

        <button
          type="button"
          className="create-advanced-toggle"
          onClick={() => setAdvanced((v) => !v)}
          aria-expanded={advanced}
        >
          <span>تنظیمات پیشرفته</span>
          <span aria-hidden>{advanced ? "▲" : "▼"}</span>
        </button>

        {advanced && (
          <div className="create-advanced-grid">
            <label>ثبت‌نام با تأخیر تا سطح (۰=خاموش)
              <input className="ui-input" type="number" min={0} max={preset.levels} value={lateRegThroughLevel} onChange={(e) => setLateRegThroughLevel(Number(e.target.value))} />
            </label>
            <label>دقیقه هر سطح
              <input className="ui-input" type="number" min={1} value={preset.levelMinutes} disabled />
            </label>
          </div>
        )}

        {err && <p className="create-error">{err}</p>}

        <button type="button" className="btn btn-gold create-submit" onClick={create} disabled={busy}>
          {busy ? "در حال ساخت…" : `ساخت «${tournamentName}»`}
        </button>
    </Modal>
  );
}
