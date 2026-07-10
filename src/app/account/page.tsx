"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, fetchMe } from "@/lib/client/api";
import { LoadingScreen, PageHeader, PageShell } from "@/components/ui";

const TYPE_FA: Record<string, string> = {
  admin_credit: "شارژ مدیر",
  admin_debit: "کسر مدیر",
  buy_in: "ورود به میز",
  cash_out: "خروج از میز",
  topup: "تاپ‌آپ",
  win: "برد",
  loss: "باخت",
  rake: "کارمزد میز",
  settlement: "تسویه",
  adjustment: "اصلاح",
};

const TYPE_ICON: Record<string, string> = {
  admin_credit: "＋",
  admin_debit: "−",
  buy_in: "♠",
  cash_out: "↩",
  topup: "↑",
  win: "★",
  loss: "✕",
  rake: "％",
  settlement: "✓",
  adjustment: "⚙",
};

interface Entry {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  note: string | null;
  settled: boolean;
  createdAt: string;
}

function isUnsettled(e: Entry) {
  return !e.settled && ["admin_credit", "admin_debit", "settlement"].includes(e.type);
}

export default function AccountPage() {
  const router = useRouter();
  const [balance, setBalance] = useState<number | null>(null);
  const [ledger, setLedger] = useState<Entry[]>([]);

  useEffect(() => {
    fetchMe().then((u) => {
      if (!u) return router.replace("/login");
      api<{ balance: number; ledger: Entry[] }>("/api/account").then((d) => {
        setBalance(d.balance);
        setLedger(d.ledger);
      });
    });
  }, [router]);

  if (balance === null) return <LoadingScreen message="در حال بارگذاری حساب…" />;

  return (
    <PageShell>
      <PageHeader title="حساب من" />

      <div className="panel account-balance">
        <div className="account-balance-label">موجودی ژتون</div>
        <div className="account-balance-amount">{balance.toLocaleString("fa")}</div>
        <span className="account-balance-unit">ژتون</span>
        <div className="account-chips" aria-hidden>
          <span className="account-chip" />
          <span className="account-chip" />
          <span className="account-chip" />
        </div>
      </div>

      <div className="account-section-head">
        <h2 className="account-section-title">تاریخچه تراکنش‌ها</h2>
        <span className="lobby-count">{ledger.length.toLocaleString("fa")}</span>
      </div>

      <div className="ledger-list">
        {ledger.length === 0 && (
          <div className="panel empty-state">
            <div className="empty-state-icon" aria-hidden>📋</div>
            <p className="empty-state-title">تراکنشی ثبت نشده</p>
            <p className="empty-state-desc">
              وقتی وارد میز شوید یا مدیر حسابتان را شارژ کند، اینجا نمایش داده می‌شود.
            </p>
          </div>
        )}
        {ledger.map((e) => {
          const credit = e.amount >= 0;
          return (
            <article key={e.id} className="panel ledger-item">
              <div className={`ledger-icon ledger-icon--${credit ? "credit" : "debit"}`} aria-hidden>
                {TYPE_ICON[e.type] ?? (credit ? "＋" : "−")}
              </div>
              <div className="ledger-body">
                <div className="ledger-title">{TYPE_FA[e.type] ?? e.type}</div>
                <div className="ledger-meta">
                  <time className="ledger-time" dateTime={e.createdAt}>
                    {new Date(e.createdAt).toLocaleString("fa")}
                  </time>
                  {e.note && <span className="ledger-note">{e.note}</span>}
                  {isUnsettled(e) && <span className="ledger-badge">تسویه‌نشده</span>}
                </div>
              </div>
              <div className="ledger-side">
                <div className={`ledger-amount ledger-amount--${credit ? "credit" : "debit"}`}>
                  {credit ? "+" : ""}
                  {e.amount.toLocaleString("fa")}
                </div>
                <div className="ledger-balance-after">
                  مانده: {e.balanceAfter.toLocaleString("fa")}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </PageShell>
  );
}
