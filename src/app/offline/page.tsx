export default function OfflinePage() {
  return (
    <main style={{ display: "grid", placeItems: "center", minHeight: "100dvh", padding: 24 }}>
      <div className="panel" style={{ padding: 24, textAlign: "center", maxWidth: 360 }}>
        <h1 style={{ marginTop: 0 }}>اتصال قطع است</h1>
        <p style={{ color: "var(--muted)" }}>
          برای بازی زنده به اینترنت نیاز دارید. پس از برقراری اتصال دوباره تلاش کنید.
        </p>
      </div>
    </main>
  );
}
