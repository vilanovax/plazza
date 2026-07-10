"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api, fetchMe } from "@/lib/client/api";
import { Field, Input, LoadingScreen, PageHeader, PageShell, Select } from "@/components/ui";

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

  const tabs: [Tab, string][] = [["users", "کاربران"], ["topups", "تاپ‌آپ"], ["settlements", "تسویه‌ها"], ["settings", "تنظیمات"]];

  return (
    <PageShell wide>
      <PageHeader title="پنل مدیریت" />
      <div className="admin-tabs" role="tablist">
        {tabs.map(([k, l]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            className={`admin-tab${tab === k ? " admin-tab--active" : ""}`}
            onClick={() => setTab(k)}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === "users" && <UsersTab />}
      {tab === "topups" && <TopupsTab />}
      {tab === "settlements" && <SettlementsTab />}
      {tab === "settings" && <SettingsTab />}
    </PageShell>
  );
}

interface AdminUser { id: string; username: string; displayName: string; role: string; chipBalance: number; isActive: boolean; }

function UsersTab() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [nu, setNu] = useState({ username: "", displayName: "", password: "", role: "player" });
  const [err, setErr] = useState("");
  const load = useCallback(() => api<{ users: AdminUser[] }>("/api/admin/users").then((d) => setUsers(d.users)), []);
  useEffect(() => { load(); }, [load]);

  async function createUser() {
    setErr("");
    try { await api("/api/admin/users", { method: "POST", body: nu }); setNu({ username: "", displayName: "", password: "", role: "player" }); load(); }
    catch (e) { setErr((e as Error).message); }
  }
  async function credit(id: string) {
    const raw = prompt("مبلغ برای شارژ (منفی برای کسر):", "1000");
    if (raw == null) return;
    const amount = Number(raw); if (!amount) return;
    await api(`/api/admin/users/${id}/credit`, { method: "POST", body: { amount } }); load();
  }
  async function toggle(u: AdminUser) {
    await api(`/api/admin/users/${u.id}/active`, { method: "POST", body: { active: !u.isActive } }); load();
  }

  return (
    <div>
      <div className="panel" style={{ padding: 14, marginBottom: 14 }}>
        <div className="profile-section-title" style={{ marginBottom: 8 }}>ساخت کاربر جدید</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
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
          <div key={u.id} className="panel list-row" style={{ opacity: u.isActive ? 1 : 0.5 }}>
            <div>
              <div style={{ fontWeight: 700 }}>{u.displayName} {u.role === "admin" ? "👑" : ""}</div>
              <div style={{ color: "var(--muted)", fontSize: 12 }}>@{u.username}</div>
            </div>
            <div className="list-row-actions">
              <div style={{ color: "var(--gold)", fontWeight: 800 }}>{u.chipBalance.toLocaleString("fa")}</div>
              <button className="btn btn-gold" style={{ fontSize: 12, padding: "0.3rem 0.6rem" }} onClick={() => credit(u.id)}>ژتون</button>
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: "0.3rem 0.6rem" }} onClick={() => toggle(u)}>{u.isActive ? "غیرفعال" : "فعال"}</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface Topup { id: string; userName: string; tableName: string; amount: number; }
function TopupsTab() {
  const [items, setItems] = useState<Topup[]>([]);
  const load = useCallback(() => api<{ topups: Topup[] }>("/api/admin/topups").then((d) => setItems(d.topups)), []);
  useEffect(() => { load(); }, [load]);
  async function decide(id: string, status: "approved" | "rejected") {
    try { await api(`/api/admin/topups/${id}/decide`, { method: "POST", body: { status } }); } catch (e) { alert((e as Error).message); }
    load();
  }
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {items.length === 0 && <div className="panel" style={{ padding: 16, color: "var(--muted)" }}>درخواست معلقی وجود ندارد.</div>}
      {items.map((t) => (
        <div key={t.id} className="panel" style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 700 }}>{t.userName} <span style={{ color: "var(--gold)" }}>+{t.amount.toLocaleString("fa")}</span></div>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>میز: {t.tableName}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={() => decide(t.id, "approved")}>تأیید</button>
            <button className="btn btn-danger" style={{ fontSize: 12 }} onClick={() => decide(t.id, "rejected")}>رد</button>
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
      <div className="panel" style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>موقعیت تسویه‌نشده هر کاربر</div>
        <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 8 }}>مثبت = طلبکار، منفی = بدهکار (بر اساس ورودی‌های تسویه‌نشده)</div>
        {rows.map((r) => (
          <div key={r.userId} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
            <span>{r.displayName}</span>
            <b style={{ color: r.net >= 0 ? "var(--accent)" : "var(--danger)" }}>{r.net.toLocaleString("fa")}</b>
          </div>
        ))}
      </div>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>دفتر کل — علامت‌گذاری تسویه</div>
      <div style={{ display: "grid", gap: 6 }}>
        {ledger.map((l) => (
          <div key={l.id} className="panel" style={{ padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 13 }}>
              <b>{l.userName}</b> · {l.type} · <span style={{ color: l.amount >= 0 ? "var(--accent)" : "var(--danger)" }}>{l.amount.toLocaleString("fa")}</span>
              <div style={{ color: "var(--muted)", fontSize: 11 }}>{new Date(l.createdAt).toLocaleString("fa")}</div>
            </div>
            <button className={`btn ${l.settled ? "btn-ghost" : "btn-gold"}`} style={{ fontSize: 12 }} onClick={() => settle(l.id, !l.settled)}>
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
    <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
      <input type="checkbox" checked={s[k] as boolean} onChange={(e) => setS({ ...s, [k]: e.target.checked })} />{label}</label>
  );
  async function save() { await api("/api/admin/settings", { method: "PUT", body: s }); setSaved(true); setTimeout(() => setSaved(false), 1500); }
  return (
    <div className="panel" style={{ padding: 16 }}>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>پیش‌فرض میزها و قوانین</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
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
      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        {bool("allow_self_topup", "بازیکن بدون تأیید مدیر بتواند تاپ‌آپ کند")}
        {bool("allow_self_register", "ثبت‌نام خودکار بازیکنان فعال باشد")}
      </div>
      <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={save}>{saved ? "ذخیره شد ✓" : "ذخیره تنظیمات"}</button>
    </div>
  );
}
