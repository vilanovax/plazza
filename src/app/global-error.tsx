"use client";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="fa" dir="rtl">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#04231a", color: "#eef2f6" }}>
        <main style={{ display: "grid", placeItems: "center", minHeight: "100dvh", padding: 24 }}>
          <div style={{ textAlign: "center", maxWidth: 340 }}>
            <h1>خطایی رخ داد</h1>
            <p style={{ color: "#9fb0c0" }}>مشکلی پیش آمد. دوباره تلاش کنید.</p>
            <button onClick={reset} style={{ marginTop: 12, padding: "0.6rem 1rem", borderRadius: 10, border: "none", background: "#2f9e6f", color: "#041a12", fontWeight: 700 }}>
              تلاش مجدد
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
