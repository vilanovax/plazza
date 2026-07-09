import Link from "next/link";

export default function NotFound() {
  return (
    <main style={{ display: "grid", placeItems: "center", minHeight: "100dvh", padding: 24 }}>
      <div className="panel" style={{ padding: 24, textAlign: "center", maxWidth: 340 }}>
        <h1 style={{ marginTop: 0 }}>۴۰۴</h1>
        <p style={{ color: "var(--muted)" }}>صفحه‌ای که دنبالش بودید پیدا نشد.</p>
        <Link href="/" className="btn btn-primary" style={{ display: "inline-block", marginTop: 8 }}>
          بازگشت به لابی
        </Link>
      </div>
    </main>
  );
}
