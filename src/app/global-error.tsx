"use client";

import "./globals.css";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="fa" dir="rtl">
      <body>
        <main className="status-page">
          <div className="panel status-card status-card--narrow">
            <div className="status-icon" aria-hidden>⚠️</div>
            <h1 className="status-title">خطایی رخ داد</h1>
            <p className="status-desc">مشکلی پیش آمد. دوباره تلاش کنید.</p>
            <div className="status-actions">
              <button type="button" className="btn btn-primary" onClick={reset}>
                تلاش مجدد
              </button>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
