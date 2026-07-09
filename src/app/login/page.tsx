"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api, fetchMe } from "@/lib/client/api";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchMe().then((u) => u && router.replace("/"));
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
      router.replace("/");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ display: "grid", placeItems: "center", minHeight: "100dvh", padding: 20 }}>
      <form onSubmit={submit} className="panel" style={{ padding: 24, width: "100%", maxWidth: 380 }}>
        <h1 style={{ margin: "0 0 4px", fontSize: 26 }}>♠ پوکر دوستانه</h1>
        <p style={{ color: "var(--muted)", marginTop: 0 }}>
          {mode === "login" ? "برای ورود حساب خود را وارد کنید" : "یک حساب جدید بسازید"}
        </p>

        <label style={labelStyle}>نام کاربری</label>
        <input value={username} onChange={(e) => setUsername(e.target.value)} style={inputStyle} autoComplete="username" />

        {mode === "register" && (
          <>
            <label style={labelStyle}>نام نمایشی</label>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} style={inputStyle} />
          </>
        )}

        <label style={labelStyle}>رمز عبور</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={inputStyle}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
        />

        {error && <div style={{ color: "var(--danger)", marginTop: 10, fontSize: 14 }}>{error}</div>}

        <button className="btn btn-primary" style={{ width: "100%", marginTop: 16 }} disabled={busy}>
          {busy ? "..." : mode === "login" ? "ورود" : "ثبت‌نام"}
        </button>

        <button
          type="button"
          onClick={() => setMode(mode === "login" ? "register" : "login")}
          className="btn btn-ghost"
          style={{ width: "100%", marginTop: 10 }}
        >
          {mode === "login" ? "حساب ندارید؟ ثبت‌نام کنید" : "قبلاً ثبت‌نام کرده‌اید؟ ورود"}
        </button>
      </form>
    </main>
  );
}

const labelStyle: React.CSSProperties = { display: "block", marginTop: 12, marginBottom: 4, fontSize: 13, color: "var(--muted)" };
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.6rem 0.7rem",
  borderRadius: 10,
  border: "1px solid var(--card-border)",
  background: "rgba(0,0,0,.25)",
  color: "var(--text)",
  fontSize: 15,
};
