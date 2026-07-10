"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api, fetchMe } from "@/lib/client/api";
import { Field, Input, LoadingScreen, Modal, PageHeader, PageShell, Select, Tabs } from "@/components/ui";

type Tab = "users" | "topups" | "settlements" | "settings";

export default function AdminPage() {
  const router = useRouter();
  const [ok, setOk] = useState(false);
  const [tab, setTab] = useState<Tab>("users");

  useEffect(() => {
    fetchMe()
      .then((u) => {
        if (!u) return router.replace("/login");
        if (u.role !== "admin") return router.replace("/");
        setOk(true);
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  if (!ok) return <LoadingScreen message="در حال بارگذاری پنل…" />;

  return (
    <PageShell wide>
      <PageHeader title="پنل مدیریت" />
      <Tabs
        ariaLabel="بخش‌های مدیریت"
        variant="gold"
        activeId={tab}
        onChange={(id) => setTab(id as Tab)}
        tabs={[
          { id: "users", label: "کاربران", panel: <UsersTab /> },
          { id: "topups", label: "تاپ‌آپ", panel: <TopupsTab /> },
          { id: "settlements", label: "تسویه‌ها", panel: <SettlementsTab /> },
          { id: "settings", label: "تنظیمات", panel: <SettingsTab /> },
        ]}
      />
    </PageShell>
  );
}

interface AdminUser { id: string; username: string; displayName: string; role: string; chipBalance: number; isActive: boolean; }

function UsersTab() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [nu, setNu] = useState({ username: "", displayName: "", password: "", role: "player" });
  const [err, setErr] = useState("");
  const [creditUser, setCreditUser] = useState<AdminUser | null>(null);
  const load = useCallback(() => api<{ users: AdminUser[] }>("/api/admin/users").then((d) => setUsers(d.users)), []);
  useEffect(() => { load(); }, [load]);

  async function createUser() {
    setErr("");
    try { await api("/api/admin/users", { method: "POST", body: nu }); setNu({ username: "", displayName: "", password: "", role: "player" }); load(); }
    catch (e) { setErr((e as Error).message); }
  }

  return (
    <div>
      <div className="panel admin-panel">
        <div className="profile-section-title" style={{ marginBottom: 8 }}>ساخت کاربر جدید</div>
        <div className="admin-form-grid">
          <Input placeholder="نام کاربری" value={nu.username} onChange={(e) => setNu({ ...nu, username: e.target.value })} />
          <Input placeholder="نام نمایشی" value={nu.displayName} onChange={(e) => setNu({ ...nu, displayName: e.target.value })} />
          <Input type="password" placeholder="رمز عبور" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} />
          <Select value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value })}>
            <option value="player">بازیکن</option>
            <option value="admin">مدیر</option>
          </Select>
        </div>
        {err && <p className="login-error">{err}</p>}
        <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={createUser}>ایجاد</button>
      </div>

      <div className="lobby-grid">
        {users.map((u) => (
          <div key={u.id} className={`panel list-row admin-user-card${u.isActive ? "" : " admin-user-card--inactive"}`}>
            <div>
              <div className="admin-user-name">{u.displayName} {u.role === "admin" ? "👑" : ""}</div>
              <div className="admin-user-handle">@{u.username}</div>
            </div>
            <div className="list-row-actions">
              <div className="admin-user-balance">{u.chipBalance.toLocaleString("fa")}</div>
              <button className="btn btn-gold admin-btn-sm" onClick={() => setCreditUser(u)}>ژتون</button>
              <button className="btn btn-ghost admin-btn-sm" onClick={() => void toggle(u, load)}>{u.isActive ? "غیرفعال" : "فعال"}</button>
            </div>
          </div>
        ))}
      </div>

      {creditUser && (
        <CreditUserModal
          user={creditUser}
          onClose={() => setCreditUser(null)}
          onDone={async () => {
            setCreditUser(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

async function toggle(u: AdminUser, load: () => void) {
  await api(`/api/admin/users/${u.id}/active`, { method: "POST", body: { active: !u.isActive } });
  load();
}

function CreditUserModal({
  user,
  onClose,
  onDone,
}: {
  user: AdminUser;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState(1000);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setErr("");
    if (!amount || Number.isNaN(amount)) return setErr("مبلغ نامعتبر است");
    setBusy(true);
    try {
      await api(`/api/admin/users/${user.id}/credit`, {
        method: "POST",
        body: { amount, note: note.trim() || undefined },
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
      title="شارژ / کسر ژتون"
      subtitle={`${user.displayName} — موجودی فعلی: ${user.chipBalance.toLocaleString("fa")}`}
      onClose={onClose}
      titleId="credit-user-title"
    >
      <Field label="مبلغ" htmlFor="credit-amount">
        <Input
          id="credit-amount"
          type="number"
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          placeholder="مثبت برای شارژ، منفی برای کسر"
        />
      </Field>
      <Field label="یادداشت (اختیاری)" htmlFor="credit-note">
        <Input
          id="credit-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="دلیل شارژ یا کسر"
          maxLength={200}
        />
      </Field>
      {err && <p className="login-error">{err}</p>}
      <div className="sit-dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>انصراف</button>
        <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
          {busy ? "در حال ثبت…" : "ثبت"}
        </button>
      </div>
    </Modal>
  );
}

interface Topup { id: string; userName: string; tableName: string; amount: number; }
function TopupsTab() {
  const [items, setItems] = useState<Topup[]>([]);
  const [err, setErr] = useState("");
  const load = useCallback(() => api<{ topups: Topup[] }>("/api/admin/topups").then((d) => setItems(d.topups)), []);
  useEffect(() => { load(); }, [load]);
  async function decide(id: string, status: "approved" | "rejected") {
    setErr("");
    try { await api(`/api/admin/topups/${id}/decide`, { method: "POST", body: { status } }); load(); }
    catch (e) { setErr((e as Error).message); }
  }
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {err && <p className="login-error" role="alert">{err}</p>}
      {items.length === 0 && <div className="panel admin-empty">درخواست معلقی وجود ندارد.</div>}
      {items.map((t) => (
        <div key={t.id} className="panel admin-topup-row">
          <div>
            <div style={{ fontWeight: 700 }}>{t.userName} <span style={{ color: "var(--gold)" }}>+{t.amount.toLocaleString("fa")}</span></div>
            <div className="admin-topup-meta">میز: {t.tableName}</div>
          </div>
          <div className="admin-topup-actions">
            <button className="btn btn-primary admin-btn-sm" onClick={() => decide(t.id, "approved")}>تأیید</button>
            <button className="btn btn-danger admin-btn-sm" onClick={() => decide(t.id, "rejected")}>رد</button>
          </div>
        </div>
      ))}
    </div>
  );
}

interface Settlement { userId: string; displayName: string; net: number; }
interface LedgerRow { id: string; userName: string; type: string; amount: number; note: string | null; settled: boolean; createdAt: string; }
function SettlementsTab() {
  const [rows, setRows] = useState<Settlement[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const load = useCallback(() => {
    api<{ settlements: Settlement[] }>("/api/admin/settlements").then((d) => setRows(d.settlements));
    api<{ ledger: LedgerRow[] }>("/api/admin/ledger").then((d) => setLedger(d.ledger));
  }, []);
  useEffect(() => { load(); }, [load]);
  async function settle(id: string, settled: boolean) {
    await api(`/api/admin/ledger/${id}/settle`, { method: "POST", body: { settled } }); load();
  }
  return (
    <div>
      <div className="panel admin-settlement-panel">
        <div style={{ fontWeight: 700, marginBottom: 8 }}>موقعیت تسویه‌نشده هر کاربر</div>
        <div className="admin-settlement-hint">مثبت = طلبکار، منفی = بدهکار (بر اساس ورودی‌های تسویه‌نشده)</div>
        {rows.map((r) => (
          <div key={r.userId} className="admin-settlement-row">
            <span>{r.displayName}</span>
            <b style={{ color: r.net >= 0 ? "var(--accent)" : "var(--danger)" }}>{r.net.toLocaleString("fa")}</b>
          </div>
        ))}
      </div>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>دفتر کل — علامت‌گذاری تسویه</div>
      <div style={{ display: "grid", gap: 6 }}>
        {ledger.map((l) => (
          <div key={l.id} className="panel admin-ledger-row">
            <div style={{ fontSize: 13 }}>
              <b>{l.userName}</b> · {l.type} · <span style={{ color: l.amount >= 0 ? "var(--accent)" : "var(--danger)" }}>{l.amount.toLocaleString("fa")}</span>
              <div className="admin-ledger-meta">{new Date(l.createdAt).toLocaleString("fa")}</div>
            </div>
            <button className={`btn ${l.settled ? "btn-ghost" : "btn-gold"} admin-btn-sm`} onClick={() => settle(l.id, !l.settled)}>
              {l.settled ? "تسویه‌شده ✓" : "تسویه"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function SettingsTab() {
  const [s, setS] = useState<Record<string, number | boolean> | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { api<{ settings: Record<string, number | boolean> }>("/api/admin/settings").then((d) => setS(d.settings)); }, []);
  if (!s) return <LoadingScreen message="در حال بارگذاری تنظیمات…" />;
  const num = (k: string, label: string) => (
    <Field label={label}>
      <Input type="number" value={s[k] as number} onChange={(e) => setS({ ...s, [k]: Number(e.target.value) })} />
    </Field>
  );
  const bool = (k: string, label: string) => (
    <label className="admin-check-row">
      <input type="checkbox" checked={s[k] as boolean} onChange={(e) => setS({ ...s, [k]: e.target.checked })} />
      {label}
    </label>
  );
  async function save() { await api("/api/admin/settings", { method: "PUT", body: s }); setSaved(true); setTimeout(() => setSaved(false), 1500); }
  return (
    <div className="panel admin-panel">
      <div style={{ fontWeight: 700, marginBottom: 10 }}>پیش‌فرض میزها و قوانین</div>
      <div className="admin-settings-grid">
        {num("default_small_blind", "اسمال بلایند")}
        {num("default_big_blind", "بیگ بلایند")}
        {num("default_min_buyin", "حداقل ورود")}
        {num("default_max_buyin", "حداکثر ورود")}
        {num("default_think_time_sec", "زمان فکر (ثانیه)")}
        {num("default_rake_percent", "درصد میز")}
        {num("default_rake_cap", "سقف rake")}
        {num("topup_min", "حداقل تاپ‌آپ")}
        {num("topup_max", "حداکثر تاپ‌آپ")}
        {num("sit_out_max_min", "حداکثر سیت‌اوت (دقیقه)")}
        {num("extra_time_sec", "زمان اضافه هر درخواست (ثانیه)")}
        {num("extra_time_requests", "تعداد درخواست زمان اضافه (۱- = نامحدود)")}
      </div>
      <div className="admin-settings-bools">
        {bool("allow_self_topup", "بازیکن بدون تأیید مدیر بتواند تاپ‌آپ کند")}
        {bool("allow_self_register", "ثبت‌نام خودکار بازیکنان فعال باشد")}
      </div>
      <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={save}>{saved ? "ذخیره شد ✓" : "ذخیره تنظیمات"}</button>
    </div>
  );
}
