"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, fetchMe, invalidateMeCache, type Me } from "@/lib/client/api";
import { Input, Field, Modal, LoadingScreen, Select, Tabs } from "@/components/ui";
import type { TableConfig } from "@/lib/poker/types";

interface TableSummary {
  id: string;
  name: string;
  config: TableConfig;
  seated: number;
  maxSeats: number;
}

const STAKES = [
  { id: "low", label: "آرام", blinds: "۲۵/۵۰", sb: 25, bb: 50, minBuyIn: 1000, maxBuyIn: 10000 },
  { id: "mid", label: "معمولی", blinds: "۵۰/۱۰۰", sb: 50, bb: 100, minBuyIn: 2000, maxBuyIn: 20000 },
  { id: "high", label: "تند", blinds: "۱۰۰/۲۰۰", sb: 100, bb: 200, minBuyIn: 4000, maxBuyIn: 40000 },
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
  const [tab, setTab] = useState<"tables" | "tournaments" | "deposits">("tables");
  const [showCreateTable, setShowCreateTable] = useState(false);
  const [editTable, setEditTable] = useState<TableSummary | null>(null);
  const [closeTarget, setCloseTarget] = useState<TableSummary | null>(null);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState("");
  const [showCreateTournament, setShowCreateTournament] = useState(false);
  const [tournamentRefresh, setTournamentRefresh] = useState(0);

  const load = useCallback(async () => {
    const { tables } = await api<{ tables: TableSummary[] }>("/api/tables");
    setTables(tables);
  }, []);

  const refreshMe = useCallback(async () => {
    const u = await fetchMe({ fresh: true });
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
    invalidateMeCache();
    router.replace("/login");
  }

  async function confirmCloseTable() {
    if (!closeTarget) return;
    setCloseError("");
    setClosing(true);
    try {
      await api(`/api/tables/${closeTarget.id}/close`, { method: "POST" });
      setCloseTarget(null);
      await load();
    } catch (e) {
      setCloseError((e as Error).message);
    } finally {
      setClosing(false);
    }
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

      <Tabs
        ariaLabel="بخش‌های لابی"
        activeId={tab}
        onChange={(id) => setTab(id as typeof tab)}
        tabs={[
          {
            id: "tables",
            label: `میزها (${tables.length.toLocaleString("fa")})`,
            panel: (
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
                    <TableCard
                      key={t.id}
                      table={t}
                      isAdmin={isAdmin}
                      onEdit={() => setEditTable(t)}
                      onClose={() => { setCloseError(""); setCloseTarget(t); }}
                    />
                  ))}
                </div>
              </section>
            ),
          },
          {
            id: "tournaments",
            label: "تورنومنت‌ها",
            panel: (
              <TournamentsSection
                isAdmin={isAdmin}
                onBalanceChange={refreshMe}
                onCreateClick={() => setShowCreateTournament(true)}
                refreshToken={tournamentRefresh}
              />
            ),
          },
          {
            id: "deposits",
            label: "خرید ژتون",
            panel: <ChipDepositsSection isAdmin={isAdmin} onBalanceChange={refreshMe} />,
          },
        ]}
      />
      </main>

      {showCreateTable && (
        <CreateTableModal
          onClose={() => setShowCreateTable(false)}
          onDone={() => { setShowCreateTable(false); load(); }}
        />
      )}

      {editTable && (
        <EditTableModal
          table={editTable}
          onClose={() => setEditTable(null)}
          onDone={() => { setEditTable(null); load(); }}
        />
      )}

      {closeTarget && (
        <CloseTableModal
          table={closeTarget}
          busy={closing}
          error={closeError}
          onCancel={() => { if (!closing) setCloseTarget(null); }}
          onConfirm={confirmCloseTable}
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

interface ChipPurchaseSummary {
  userId: string;
  displayName: string;
  chipBalance: number;
  totalPurchased: number;
  purchaseCount: number;
}

interface ChipDepositEntry {
  id: string;
  userId: string;
  displayName: string;
  amount: number;
  note: string | null;
  settled: boolean;
  createdAt: string;
  recordedBy: string | null;
}

function ChipDepositsSection({ isAdmin, onBalanceChange }: { isAdmin: boolean; onBalanceChange: () => void }) {
  const [summary, setSummary] = useState<ChipPurchaseSummary[]>([]);
  const [recent, setRecent] = useState<ChipDepositEntry[]>([]);
  const [err, setErr] = useState("");
  const [depositOpen, setDepositOpen] = useState(false);
  const [depositUserId, setDepositUserId] = useState("");

  // Promise-chain (not async/await) so the setState calls live in deferred
  // callbacks — calling this from the mount effect stays clear of the
  // set-state-in-effect rule. Error clears on success rather than up front, so a
  // stale error simply persists until the refetch resolves.
  const load = useCallback(
    () =>
      api<{ summary: ChipPurchaseSummary[]; recent: ChipDepositEntry[] }>("/api/chip-deposits")
        .then((data) => {
          setSummary(data.summary);
          setRecent(data.recent);
          setErr("");
        })
        .catch((e) => setErr((e as Error).message)),
    []
  );

  useEffect(() => { void load(); }, [load]);

  async function toggleSettled(entry: ChipDepositEntry) {
    if (!isAdmin) return;
    try {
      await api(`/api/admin/ledger/${entry.id}/settle`, { method: "POST", body: { settled: !entry.settled } });
      await load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <section className="lobby-section chip-deposits-section" aria-labelledby="deposits-heading">
      <div className="chip-deposits-head">
        <div>
          <h2 id="deposits-heading" className="chip-deposits-title">جدول خرید ژتون</h2>
          <p className="chip-deposits-desc">مجموع ژتون‌های خریداری‌شده از مدیر و تاریخچه واریزها</p>
        </div>
        {isAdmin && (
          <button
            type="button"
            className="btn btn-gold"
            onClick={() => {
              setDepositUserId(summary[0]?.userId ?? "");
              setDepositOpen(true);
            }}
          >
            ثبت واریز
          </button>
        )}
      </div>

      {err && <p className="login-error">{err}</p>}

      <div className="panel chip-deposits-table-wrap">
        <table className="chip-deposits-table">
          <thead>
            <tr>
              <th scope="col">بازیکن</th>
              <th scope="col">کل خرید</th>
              <th scope="col">تعداد</th>
              <th scope="col">موجودی فعلی</th>
              {isAdmin && <th scope="col">عملیات</th>}
            </tr>
          </thead>
          <tbody>
            {summary.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 5 : 4} className="chip-deposits-empty">هنوز خریدی ثبت نشده</td>
              </tr>
            )}
            {summary.map((row) => (
              <tr key={row.userId}>
                <td>{row.displayName}</td>
                <td className="chip-deposits-amount">{row.totalPurchased.toLocaleString("fa")}</td>
                <td>{row.purchaseCount.toLocaleString("fa")}</td>
                <td>{row.chipBalance.toLocaleString("fa")}</td>
                {isAdmin && (
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost chip-deposits-action"
                      onClick={() => {
                        setDepositUserId(row.userId);
                        setDepositOpen(true);
                      }}
                    >
                      واریز
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="chip-deposits-subtitle">تاریخچه واریزها</h3>
      <div className="panel chip-deposits-table-wrap">
        <table className="chip-deposits-table chip-deposits-table--recent">
          <thead>
            <tr>
              <th scope="col">زمان</th>
              <th scope="col">بازیکن</th>
              <th scope="col">مبلغ</th>
              <th scope="col">یادداشت</th>
              <th scope="col">ثبت‌کننده</th>
              <th scope="col">تسویه</th>
              {isAdmin && <th scope="col" />}
            </tr>
          </thead>
          <tbody>
            {recent.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 7 : 6} className="chip-deposits-empty">واریزی ثبت نشده</td>
              </tr>
            )}
            {recent.map((entry) => (
              <tr key={entry.id}>
                <td className="chip-deposits-time">
                  {new Date(entry.createdAt).toLocaleString("fa", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </td>
                <td>{entry.displayName}</td>
                <td className="chip-deposits-amount">+{entry.amount.toLocaleString("fa")}</td>
                <td className="chip-deposits-note">{entry.note ?? "—"}</td>
                <td>{entry.recordedBy ?? "—"}</td>
                <td>
                  <span className={`chip-deposits-settled${entry.settled ? " chip-deposits-settled--ok" : ""}`}>
                    {entry.settled ? "تسویه شد" : "تسویه‌نشده"}
                  </span>
                </td>
                {isAdmin && (
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost chip-deposits-action"
                      onClick={() => void toggleSettled(entry)}
                    >
                      {entry.settled ? "بازگشت" : "تسویه"}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {depositOpen && (
        <RecordDepositModal
          users={summary}
          initialUserId={depositUserId}
          onClose={() => setDepositOpen(false)}
          onDone={async () => {
            setDepositOpen(false);
            await load();
            onBalanceChange();
          }}
        />
      )}
    </section>
  );
}

function RecordDepositModal({
  users,
  initialUserId,
  onClose,
  onDone,
}: {
  users: ChipPurchaseSummary[];
  initialUserId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [userId, setUserId] = useState(initialUserId);
  const [amount, setAmount] = useState(1000);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setErr("");
    if (!userId) return setErr("بازیکن را انتخاب کنید");
    if (amount <= 0) return setErr("مبلغ باید مثبت باشد");
    if (!note.trim()) return setErr("یادداشت واریز الزامی است (مثلاً شماره کارت یا مبلغ ریالی)");
    setBusy(true);
    try {
      await api(`/api/admin/users/${userId}/credit`, {
        method: "POST",
        body: { amount, note: note.trim() },
      });
      await onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="ثبت واریز ژتون"
      subtitle="شارژ حساب بازیکن پس از دریافت وجه"
      onClose={onClose}
      titleId="record-deposit-title"
      className="record-deposit-modal"
    >
      <Field label="بازیکن" htmlFor="deposit-user">
        <Select
          id="deposit-user"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
        >
          {users.map((u) => (
            <option key={u.userId} value={u.userId}>{u.displayName}</option>
          ))}
        </Select>
      </Field>
      <Field label="مبلغ ژتون" htmlFor="deposit-amount">
        <Input
          id="deposit-amount"
          type="number"
          min={1}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
        />
      </Field>
      <Field label="یادداشت واریز" htmlFor="deposit-note">
        <Input
          id="deposit-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="مثلاً واریز ۵۰۰ هزار تومان — کارت ۶۰۳۷…"
          maxLength={200}
        />
      </Field>
      {err && <p className="login-error">{err}</p>}
      <div className="sit-dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>انصراف</button>
        <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
          {busy ? "در حال ثبت…" : "ثبت واریز"}
        </button>
      </div>
    </Modal>
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
  const [err, setErr] = useState("");
  const load = useCallback(() => api<{ tournaments: TournamentSummary[] }>("/api/tournaments").then((d) => setItems(d.tournaments)), []);
  useEffect(() => { load(); }, [load, refreshToken]);

  async function register(id: string) {
    setErr("");
    try { await api(`/api/tournaments/${id}/register`, { method: "POST" }); load(); onBalanceChange(); }
    catch (e) { setErr((e as Error).message); }
  }
  async function start(id: string) {
    setErr("");
    try { await api(`/api/tournaments/${id}/start`, { method: "POST" }); load(); }
    catch (e) { setErr((e as Error).message); }
  }

  return (
    <section className="lobby-section" aria-labelledby="tournaments-heading">
      {err && <p className="login-error" role="alert">{err}</p>}
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

function TableCard({
  table,
  isAdmin,
  onEdit,
  onClose,
}: {
  table: TableSummary;
  isAdmin: boolean;
  onEdit: () => void;
  onClose: () => void;
}) {
  return (
    <article className="table-card-wrap panel">
      <Link href={`/table/${table.id}`} className="table-card">
        <div>
          <div className="table-card-name">{table.name}</div>
          <div className="table-card-meta">
            <span className="meta-pill meta-pill--gold">
              بلایند {table.config.smallBlind.toLocaleString("fa")}/{table.config.bigBlind.toLocaleString("fa")}
            </span>
            <span className="meta-pill">
              ورود {table.config.minBuyIn.toLocaleString("fa")}–{table.config.maxBuyIn.toLocaleString("fa")}
            </span>
            <span className="meta-pill">
              {table.maxSeats.toLocaleString("fa")} نفره
            </span>
          </div>
        </div>
        <div className="table-card-side">
          <SeatDots seated={table.seated} max={table.maxSeats} />
          <span className="table-card-enter">
            ورود
            <span aria-hidden>←</span>
          </span>
        </div>
      </Link>
      {isAdmin && (
        <div className="table-card-admin" role="group" aria-label={`مدیریت ${table.name}`}>
          <button
            type="button"
            className="btn btn-ghost table-card-admin-btn"
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
          >
            ویرایش
          </button>
          <button
            type="button"
            className="btn btn-danger table-card-admin-btn"
            onClick={(e) => { e.stopPropagation(); onClose(); }}
          >
            بستن میز
          </button>
        </div>
      )}
    </article>
  );
}

function CloseTableModal({
  table,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  table: TableSummary;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      title="بستن میز"
      subtitle={table.name}
      onClose={onCancel}
      titleId="close-table-title"
      className="close-table-modal"
    >
      <p className="close-table-desc">
        {table.seated > 0
          ? `${table.seated.toLocaleString("fa")} بازیکن روی میز است. با بستن میز، ژتون‌های روی میز به حساب بازیکنان برمی‌گردد.`
          : "این میز از لابی حذف می‌شود و دیگر قابل ورود نخواهد بود."}
      </p>
      <div className="close-table-meta">
        <span className="meta-pill meta-pill--gold">
          بلایند {table.config.smallBlind.toLocaleString("fa")}/{table.config.bigBlind.toLocaleString("fa")}
        </span>
        <span className="meta-pill">
          {table.seated.toLocaleString("fa")}/{table.maxSeats.toLocaleString("fa")} بازیکن
        </span>
      </div>
      {error && <p className="create-error">{error}</p>}
      <div className="sit-dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          انصراف
        </button>
        <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={busy}>
          {busy ? "در حال بستن…" : "بله، میز بسته شود"}
        </button>
      </div>
    </Modal>
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

function EditTableModal({
  table,
  onClose,
  onDone,
}: {
  table: TableSummary;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(table.name);
  const [smallBlind, setSmallBlind] = useState(table.config.smallBlind);
  const [bigBlind, setBigBlind] = useState(table.config.bigBlind);
  const [minBuyIn, setMinBuyIn] = useState(table.config.minBuyIn);
  const [maxBuyIn, setMaxBuyIn] = useState(table.config.maxBuyIn);
  const [maxSeats, setMaxSeats] = useState(table.config.maxSeats);
  const [thinkTimeSec, setThinkTimeSec] = useState(table.config.thinkTimeSec);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setErr("");
    setBusy(true);
    try {
      await api(`/api/tables/${table.id}`, {
        method: "PATCH",
        body: {
          name: name.trim() || table.name,
          smallBlind,
          bigBlind,
          minBuyIn,
          maxBuyIn,
          maxSeats,
          thinkTimeSec,
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
      title="ویرایش میز"
      subtitle={`${table.seated.toLocaleString("fa")} بازیکن seated · تغییر بلایند فقط بین دست‌ها`}
      onClose={onClose}
      titleId="edit-table-title"
      className="edit-table-modal"
    >
      <Field label="نام میز" htmlFor="edit-table-name">
        <Input id="edit-table-name" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>

      <div className="create-advanced-grid">
        <label>بلایند کوچک
          <input className="ui-input" type="number" min={1} value={smallBlind} onChange={(e) => setSmallBlind(Number(e.target.value))} />
        </label>
        <label>بلایند بزرگ
          <input className="ui-input" type="number" min={1} value={bigBlind} onChange={(e) => setBigBlind(Number(e.target.value))} />
        </label>
        <label>حداقل ورود
          <input className="ui-input" type="number" min={1} value={minBuyIn} onChange={(e) => setMinBuyIn(Number(e.target.value))} />
        </label>
        <label>حداکثر ورود
          <input className="ui-input" type="number" min={1} value={maxBuyIn} onChange={(e) => setMaxBuyIn(Number(e.target.value))} />
        </label>
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
              disabled={n < table.seated}
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

      {err && <p className="create-error">{err}</p>}

      <div className="sit-dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>انصراف</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
          {busy ? "در حال ذخیره…" : "ذخیره تغییرات"}
        </button>
      </div>
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
