"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, fetchMe } from "@/lib/client/api";
import { RANKS, SUITS, SUIT_SYMBOLS, stringToCard } from "@/lib/poker/cards";
import { PlayingCard } from "@/components/PlayingCard";
import {
  AVATARS, CARD_BACKS, CHIP_COLORS, EMOTES,
  TAGLINE_MAX, TITLE_MAX, MAX_FAVORITE_CARDS, MAX_EMOTES,
} from "@/lib/profile/presets";

interface Profile {
  displayName: string; avatar: string; tagline: string; title: string;
  favoriteCards: string[]; cardBack: string; chipColor: string; emotes: string[]; statsPublic: boolean;
}
const RED = new Set([1, 2]); // diamonds, hearts

export default function ProfilePage() {
  const router = useRouter();
  const [p, setP] = useState<Profile | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetchMe()
      .then((u) => (u ? api<{ profile: Profile }>("/api/profile").then((d) => setP(d.profile)) : router.replace("/login")))
      .catch(() => router.replace("/login"));
  }, [router]);

  const set = useCallback(<K extends keyof Profile>(k: K, v: Profile[K]) => setP((prev) => (prev ? { ...prev, [k]: v } : prev)), []);

  function toggleFavorite(code: string) {
    if (!p) return;
    const has = p.favoriteCards.includes(code);
    if (has) set("favoriteCards", p.favoriteCards.filter((c) => c !== code));
    else if (p.favoriteCards.length < MAX_FAVORITE_CARDS) set("favoriteCards", [...p.favoriteCards, code]);
  }
  function toggleEmote(e: string) {
    if (!p) return;
    const has = p.emotes.includes(e);
    if (has) set("emotes", p.emotes.filter((x) => x !== e));
    else if (p.emotes.length < MAX_EMOTES) set("emotes", [...p.emotes, e]);
  }

  async function save() {
    if (!p) return;
    setSaving(true); setMsg("");
    try {
      const { profile } = await api<{ profile: Profile }>("/api/profile", { method: "PUT", body: p });
      setP(profile); setMsg("ذخیره شد ✓");
    } catch (e) { setMsg((e as Error).message); }
    finally { setSaving(false); }
  }

  if (!p) return <main style={{ padding: 24 }}>در حال بارگذاری…</main>;

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: 16 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <Link href="/" className="btn btn-ghost" style={{ padding: "0.3rem 0.7rem", fontSize: 13 }}>→ لابی</Link>
        <h1 style={{ fontSize: 20, margin: 0 }}>پروفایل من</h1>
      </header>

      {/* Preview */}
      <div className="panel" style={{ padding: 16, marginBottom: 14, display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ fontSize: 40, lineHeight: 1 }}>{p.avatar || "🙂"}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 18 }}>{p.displayName || "—"} {p.title && <span style={{ color: "var(--gold)", fontSize: 13 }}>«{p.title}»</span>}</div>
          {p.tagline && <div style={{ color: "var(--muted)", fontSize: 13 }}>“{p.tagline}”</div>}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {p.favoriteCards.map((c) => <PlayingCard key={c} card={stringToCard(c)} small />)}
        </div>
      </div>

      <Field label="نام نمایشی">
        <input value={p.displayName} maxLength={40} onChange={(e) => set("displayName", e.target.value)} style={input} />
      </Field>

      <Field label="آواتار">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {AVATARS.map((a) => (
            <button key={a} onClick={() => set("avatar", p.avatar === a ? "" : a)} style={chip(p.avatar === a)}>{a}</button>
          ))}
        </div>
      </Field>

      <Field label={`لقب (${p.title.length}/${TITLE_MAX})`}>
        <input value={p.title} maxLength={TITLE_MAX} placeholder="مثلاً سلطان بلوف" onChange={(e) => set("title", e.target.value)} style={input} />
      </Field>

      <Field label={`شعار (${p.tagline.length}/${TAGLINE_MAX})`}>
        <input value={p.tagline} maxLength={TAGLINE_MAX} placeholder="مثلاً بلوف تخصص منه" onChange={(e) => set("tagline", e.target.value)} style={input} />
      </Field>

      <Field label={`دو کارت مورد علاقه (${p.favoriteCards.length}/${MAX_FAVORITE_CARDS})`}>
        <div style={{ overflowX: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${RANKS.length}, 1fr)`, gap: 3, minWidth: 360 }}>
            {SUITS.map((_, s) =>
              RANKS.map((r) => {
                const code = `${r}${SUITS[s]}`;
                const sel = p.favoriteCards.includes(code);
                return (
                  <button key={code} onClick={() => toggleFavorite(code)}
                    style={{ padding: "4px 0", fontSize: 12, borderRadius: 5, cursor: "pointer",
                      border: sel ? "2px solid var(--gold)" : "1px solid var(--border,#3334)",
                      background: sel ? "var(--gold)" : "#f6f7f9", color: RED.has(s) ? "#c0322d" : "#111", fontWeight: 700 }}
                    title={code}>
                    {r === "T" ? "10" : r}{SUIT_SYMBOLS[s]}
                  </button>
                );
              })
            )}
          </div>
        </div>
      </Field>

      <Field label="پشت کارت">
        <div style={{ display: "flex", gap: 8 }}>
          {CARD_BACKS.map((cb) => (
            <button key={cb.id} onClick={() => set("cardBack", p.cardBack === cb.id ? "" : cb.id)}
              style={{ width: 40, height: 54, borderRadius: 7, background: cb.color, cursor: "pointer",
                border: p.cardBack === cb.id ? "3px solid var(--gold)" : "2px solid #0004" }} title={cb.name} />
          ))}
        </div>
      </Field>

      <Field label="رنگ ژتون">
        <div style={{ display: "flex", gap: 8 }}>
          {CHIP_COLORS.map((c) => (
            <button key={c} onClick={() => set("chipColor", p.chipColor === c ? "" : c)}
              style={{ width: 30, height: 30, borderRadius: "50%", background: c, cursor: "pointer",
                border: p.chipColor === c ? "3px solid var(--gold)" : "2px solid #0004" }} />
          ))}
        </div>
      </Field>

      <Field label={`ایموت‌های سریع (${p.emotes.length}/${MAX_EMOTES})`}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {EMOTES.map((e) => (
            <button key={e} onClick={() => toggleEmote(e)} style={chip(p.emotes.includes(e))}>{e}</button>
          ))}
        </div>
      </Field>

      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, margin: "10px 0" }}>
        <input type="checkbox" checked={p.statsPublic} onChange={(e) => set("statsPublic", e.target.checked)} />
        نمایش آمار من به دیگران
      </label>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8 }}>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? "در حال ذخیره…" : "ذخیره"}</button>
        {msg && <span style={{ color: msg.includes("✓") ? "var(--accent)" : "var(--danger,#e33)", fontSize: 13 }}>{msg}</span>}
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

const input: React.CSSProperties = { width: "100%", padding: "0.5rem 0.7rem", borderRadius: 8, border: "1px solid var(--border,#3335)", background: "var(--panel,#1b1b1f)", color: "inherit", fontSize: 14 };
function chip(active: boolean): React.CSSProperties {
  return { fontSize: 20, width: 40, height: 40, borderRadius: 8, cursor: "pointer",
    border: active ? "2px solid var(--gold)" : "1px solid var(--border,#3334)", background: active ? "#f0c94622" : "transparent" };
}
