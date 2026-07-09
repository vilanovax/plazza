"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, fetchMe, type Me } from "@/lib/client/api";

interface TableSummary {
  id: string;
  name: string;
  config: { smallBlind: number; bigBlind: number; minBuyIn: number; maxBuyIn: number };
  seated: number;
  maxSeats: number;
}

export default function LobbyPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [tables, setTables] = useState<TableSummary[]>([]);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    const { tables } = await api<{ tables: TableSummary[] }>("/api/tables");
    setTables(tables);
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

  if (!me) return <main style={{ padding: 24 }}>در حال بارگذاری…</main>;

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 16 }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>♠ لابی پوکر</div>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>خوش آمدید، {me.displayName}</div>
        </div>
        <div style={{ textAlign: "left" }}>
          <div style={{ color: "var(--gold)", fontWeight: 800, fontSize: 18 }}>{me.chipBalance.toLocaleString("fa")} ژتون</div>
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <Link href="/account" className="btn btn-ghost" style={{ fontSize: 13, padding: "0.35rem 0.7rem" }}>
              حساب من
            </Link>
            {me.role === "admin" && (
              <Link href="/admin" className="btn btn-gold" style={{ fontSize: 13, padding: "0.35rem 0.7rem" }}>
                مدیریت
              </Link>
            )}
            <button onClick={logout} className="btn btn-ghost" style={{ fontSize: 13, padding: "0.35rem 0.7rem" }}>
              خروج
            </button>
          </div>
        </div>
      </header>

      {me.role === "admin" && (
        <button className="btn btn-primary" style={{ marginBottom: 12 }} onClick={() => setShowCreate((s) => !s)}>
          + ساخت میز جدید
        </button>
      )}

      {showCreate && <CreateTable onDone={() => { setShowCreate(false); load(); }} />}

      <div style={{ display: "grid", gap: 10 }}>
        {tables.length === 0 && <div className="panel" style={{ padding: 20, color: "var(--muted)" }}>هنوز میزی وجود ندارد.</div>}
        {tables.map((t) => (
          <Link key={t.id} href={`/table/${t.id}`} className="panel" style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center", textDecoration: "none", color: "var(--text)" }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 17 }}>{t.name}</div>
              <div style={{ color: "var(--muted)", fontSize: 13 }}>
                بلایند {t.config.smallBlind}/{t.config.bigBlind} · ورود {t.config.minBuyIn.toLocaleString("fa")}–{t.config.maxBuyIn.toLocaleString("fa")}
              </div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontWeight: 800 }}>{t.seated}/{t.maxSeats}</div>
              <div style={{ color: "var(--accent)", fontSize: 13 }}>ورود ←</div>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}

function CreateTable({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({
    name: "میز جدید", smallBlind: 5, bigBlind: 10, maxSeats: 6, ante: 0,
    minBuyIn: 200, maxBuyIn: 2000, thinkTimeSec: 30, rakePercent: 0, rakeCap: 0,
    topUpMin: 100, topUpMax: 2000, tableDurationMin: 0,
  });
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: k === "name" ? e.target.value : Number(e.target.value) });

  async function create() {
    setErr("");
    try {
      await api("/api/tables", { method: "POST", body: f });
      onDone();
    } catch (e) { setErr((e as Error).message); }
  }

  const field = (label: string, k: keyof typeof f, type = "number") => (
    <label style={{ fontSize: 12, color: "var(--muted)" }}>
      {label}
      <input type={type} value={f[k] as number | string} onChange={set(k)} style={miniInput} />
    </label>
  );

  return (
    <div className="panel" style={{ padding: 16, marginBottom: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {field("نام میز", "name", "text")}
        {field("تعداد صندلی", "maxSeats")}
        {field("اسمال بلایند", "smallBlind")}
        {field("بیگ بلایند", "bigBlind")}
        {field("آنته", "ante")}
        {field("زمان فکر (ثانیه)", "thinkTimeSec")}
        {field("حداقل ورود", "minBuyIn")}
        {field("حداکثر ورود", "maxBuyIn")}
        {field("درصد میز (rake)", "rakePercent")}
        {field("سقف rake", "rakeCap")}
        {field("حداقل تاپ‌آپ", "topUpMin")}
        {field("حداکثر تاپ‌آپ", "topUpMax")}
        {field("مدت میز (دقیقه، ۰=نامحدود)", "tableDurationMin")}
      </div>
      {err && <div style={{ color: "var(--danger)", marginTop: 8, fontSize: 13 }}>{err}</div>}
      <button className="btn btn-primary" style={{ marginTop: 12, width: "100%" }} onClick={create}>ایجاد میز</button>
    </div>
  );
}

const miniInput: React.CSSProperties = {
  width: "100%", marginTop: 4, padding: "0.45rem 0.5rem", borderRadius: 8,
  border: "1px solid var(--card-border)", background: "rgba(0,0,0,.25)", color: "var(--text)",
};
