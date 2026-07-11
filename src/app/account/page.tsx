"use client";
import { useEffect, useMemo, useState } from "react";
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

function formatDayLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfEntry = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((startOfToday.getTime() - startOfEntry.getTime()) / 86_400_000);
  if (diffDays === 0) return "امروز";
  if (diffDays === 1) return "دیروز";
  return d.toLocaleDateString("fa", { weekday: "long", month: "long", day: "numeric" });
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("fa", { hour: "2-digit", minute: "2-digit" });
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

  const unsettledCount = useMemo(() => ledger.filter(isUnsettled).length, [ledger]);
  const groups = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const e of ledger) {
      const key = new Date(e.createdAt).toDateString();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return [...map.entries()].map(([, items]) => ({
      label: formatDayLabel(items[0]!.createdAt),
      items,
    }));
  }, [ledger]);

  if (balance === null) return <LoadingScreen message="در حال بارگذاری حساب…" />;

  return (
    <PageShell className="account-shell">
      <PageHeader title="حساب من" />

      <div className="account-balance">
        <div className="account-balance-glow" aria-hidden />
        <div className="account-balance-inner">
          <div className="account-balance-top">
            <span className="account-balance-icon" aria-hidden>🪙</span>
            <span className="account-balance-label">موجودی ژتون</span>
          </div>
          <div className="account-balance-amount">{balance.toLocaleString("fa")}</div>
          <span className="account-balance-unit">ژتون قابل استفاده</span>
          <div className="account-chips" aria-hidden>
            <span className="account-chip account-chip--1" />
            <span className="account-chip account-chip--2" />
            <span className="account-chip account-chip--3" />
          </div>
        </div>
      </div>

      {unsettledCount > 0 && (
        <div className="account-unsettled-banner" role="status">
          <span className="account-unsettled-icon" aria-hidden>⏳</span>
          <span>
            {unsettledCount.toLocaleString("fa")} تراکنش تسویه‌نشده — منتظر تأیید مدیر
          </span>
        </div>
      )}

      <div className="account-section-head">
        <h2 className="account-section-title">تاریخچه تراکنش‌ها</h2>
        <span className="account-count">{ledger.length.toLocaleString("fa")}</span>
      </div>

      <div className="ledger-list">
        {ledger.length === 0 && (
          <div className="panel account-empty">
            <div className="account-empty-icon" aria-hidden>♠</div>
            <p className="account-empty-title">تراکنشی ثبت نشده</p>
            <p className="account-empty-desc">
              وقتی وارد میز شوید یا مدیر حسابتان را شارژ کند، اینجا نمایش داده می‌شود.
            </p>
          </div>
        )}

        {groups.map((group) => (
          <section key={group.label} className="ledger-day-group">
            <h3 className="ledger-day-label">{group.label}</h3>
            {group.items.map((e) => {
              const credit = e.amount >= 0;
              return (
                <article
                  key={e.id}
                  className={`ledger-item ledger-item--${credit ? "credit" : "debit"} ledger-item--${e.type}`}
                >
                  <div className={`ledger-icon ledger-icon--${credit ? "credit" : "debit"}`} aria-hidden>
                    {TYPE_ICON[e.type] ?? (credit ? "＋" : "−")}
                  </div>
                  <div className="ledger-body">
                    <div className="ledger-title-row">
                      <span className="ledger-title">{TYPE_FA[e.type] ?? e.type}</span>
                      <time className="ledger-time" dateTime={e.createdAt}>
                        {formatTime(e.createdAt)}
                      </time>
                    </div>
                    {(e.note || isUnsettled(e)) && (
                      <div className="ledger-meta">
                        {e.note && <span className="ledger-note">{e.note}</span>}
                        {isUnsettled(e) && <span className="ledger-badge">تسویه‌نشده</span>}
                      </div>
                    )}
                  </div>
                  <div className="ledger-side">
                    <div className={`ledger-amount ledger-amount--${credit ? "credit" : "debit"}`}>
                      {credit ? "+" : ""}
                      {e.amount.toLocaleString("fa")}
                    </div>
                    <div className="ledger-balance-after">
                      مانده {e.balanceAfter.toLocaleString("fa")}
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
        ))}
      </div>
    </PageShell>
  );
}
