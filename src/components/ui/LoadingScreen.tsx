"use client";

export function LoadingScreen({ message = "در حال بارگذاری…" }: { message?: string }) {
  return (
    <main className="lobby-loading">
      <div className="lobby-spinner" aria-hidden />
      <span>{message}</span>
    </main>
  );
}
