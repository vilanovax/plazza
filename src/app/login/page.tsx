"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api, fetchMe, invalidateMeCache } from "@/lib/client/api";
import { Field, Input, LoadingScreen } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    fetchMe().then((u) => {
      if (u) router.replace("/");
      else setChecking(false);
    });
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "login") {
        await api("/api/auth/login", { method: "POST", body: { username, password } });
      } else {
        await api("/api/auth/register", { method: "POST", body: { username, password, displayName } });
      }
      invalidateMeCache();
      router.replace("/");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (checking) return <LoadingScreen message="در حال بررسی نشست…" />;

  return (
    <main className="login-page">
      <form onSubmit={submit} className="panel login-card">
        <div className="login-hero">
          <div className="login-logo" aria-hidden>♠</div>
          <h1 className="login-title">Plazza</h1>
          <p className="login-subtitle">
            {mode === "login" ? "برای ورود حساب خود را وارد کنید" : "یک حساب جدید بسازید"}
          </p>
        </div>

        <Field label="نام کاربری" htmlFor="username">
          <Input
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </Field>

        {mode === "register" && (
          <Field label="نام نمایشی" htmlFor="displayName">
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />
          </Field>
        )}

        <Field label="رمز عبور" htmlFor="password">
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
          />
        </Field>

        {error && <p className="login-error" role="alert">{error}</p>}

        <button className="btn btn-primary login-btn-full" disabled={busy}>
          {busy ? "..." : mode === "login" ? "ورود" : "ثبت‌نام"}
        </button>

        <button
          type="button"
          onClick={() => setMode(mode === "login" ? "register" : "login")}
          className="btn btn-ghost login-btn-full"
        >
          {mode === "login" ? "حساب ندارید؟ ثبت‌نام کنید" : "قبلاً ثبت‌نام کرده‌اید؟ ورود"}
        </button>
      </form>
    </main>
  );
}
