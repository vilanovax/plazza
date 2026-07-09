"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, fetchMe } from "@/lib/client/api";

const TYPE_FA: Record<string, string> = {
  admin_credit: "شارژ مدیر", admin_debit: "کسر مدیر", buy_in: "ورود به میز", cash_out: "خروج از میز",
  topup: "تاپ‌آپ", win: "برد", loss: "باخت", rake: "کارمزد میز", settlement: "تسویه", adjustment: "اصلاح",
};

interface Entry { id: string; type: string; amount: number; balanceAfter: number; note: string | null; settled: boolean; createdAt: string; }

export default function AccountPage() {
  const router = useRouter();
  const [balance, setBalance] = useState(0);
  const [ledger, setLedger] = useState<Entry[]>([]);

  useEffect(() => {
    fetchMe().then((u) => {
      if (!u) return router.replace("/login");
      api<{ balance: number; ledger: Entry[] }>("/api/account").then((d) => { setBalance(d.balance); setLedger(d.ledger); });
    });
  }, [router]);

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: 16 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <Link href="/" className="btn btn-ghost" style={{ padding: "0.3rem 0.7rem", fontSize: 13 }}>→ لابی</Link>
        <h1 style={{ fontSize: 20, margin: 0 }}>حساب من</h1>
      </header>

      <div className="panel" style={{ padding: 20, textAlign: "center", marginBottom: 16 }}>
        <div style={{ color: "var(--muted)", fontSize: 13 }}>موجودی ژتون</div>
        <div style={{ color: "var(--gold)", fontSize: 34, fontWeight: 800 }}>{balance.toLocaleString("fa")}</div>
      </div>

      <h3 style={{ fontSize: 15, color: "var(--muted)" }}>تاریخچه</h3>
      <div style={{ display: "grid", gap: 6 }}>
        {ledger.length === 0 && <div className="panel" style={{ padding: 16, color: "var(--muted)" }}>تراکنشی ثبت نشده است.</div>}
        {ledger.map((e) => (
          <div key={e.id} className="panel" style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 600 }}>{TYPE_FA[e.type] ?? e.type}</div>
              <div style={{ color: "var(--muted)", fontSize: 12 }}>
                {new Date(e.createdAt).toLocaleString("fa")}{e.note ? ` · ${e.note}` : ""}
                {!e.settled && ["admin_credit", "admin_debit", "settlement"].includes(e.type) ? " · تسویه‌نشده" : ""}
              </div>
            </div>
            <div style={{ textAlign: "left" }}>
              <div style={{ fontWeight: 800, color: e.amount >= 0 ? "var(--accent)" : "var(--danger)" }}>
                {e.amount >= 0 ? "+" : ""}{e.amount.toLocaleString("fa")}
              </div>
              <div style={{ color: "var(--muted)", fontSize: 11 }}>مانده: {e.balanceAfter.toLocaleString("fa")}</div>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
