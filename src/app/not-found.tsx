import Link from "next/link";

export default function NotFound() {
  return (
    <main className="status-page">
      <div className="panel status-card status-card--narrow">
        <div className="status-icon" aria-hidden>🃏</div>
        <h1 className="status-title">۴۰۴</h1>
        <p className="status-desc">صفحه‌ای که دنبالش بودید پیدا نشد.</p>
        <div className="status-actions">
          <Link href="/" className="btn btn-primary">
            بازگشت به لابی
          </Link>
        </div>
      </div>
    </main>
  );
}
