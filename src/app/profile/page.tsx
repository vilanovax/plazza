"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Field, Input, LoadingScreen, PageHeader, PageShell } from "@/components/ui";
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
  const [myId, setMyId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetchMe()
      .then((u) => {
        if (!u) return router.replace("/login");
        setMyId(u.id);
        return api<{ profile: Profile }>("/api/profile").then((d) => setP(d.profile));
      })
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

  if (!p) return <LoadingScreen message="در حال بارگذاری پروفایل…" />;

  const chipAccent = p.chipColor || "var(--gold)";

  return (
    <PageShell style={{ "--profile-chip": chipAccent } as React.CSSProperties}>
      <PageHeader
        title="پروفایل من"
        right={myId ? (
          <Link href={`/u/${myId}`} className="btn btn-ghost page-back" style={{ justifyContent: "flex-end" }}>
            نمای عمومی
          </Link>
        ) : undefined}
      />

      {/* Player card preview */}
      <section className="panel profile-hero" aria-label="پیش‌نمایش پروفایل">
        <div className="profile-hero-top">
          <div className="profile-avatar-wrap">
            <div className="profile-avatar-ring">
              <span className="profile-avatar-emoji">{p.avatar || "🙂"}</span>
            </div>
          </div>
          <div className="profile-hero-info">
            <h2 className="profile-hero-name">{p.displayName || "بازیکن"}</h2>
            {p.title && <span className="profile-hero-title">{p.title}</span>}
            {p.tagline ? (
              <p className="profile-hero-tagline">«{p.tagline}»</p>
            ) : (
              <p className="profile-hero-tagline" style={{ opacity: 0.55 }}>شعار خود را اضافه کنید…</p>
            )}
          </div>
        </div>
        <div className="profile-hero-cards">
          {p.favoriteCards.length > 0 ? (
            p.favoriteCards.map((c) => (
              <span key={c} className="playing-card-wrap">
                <PlayingCard card={stringToCard(c)} />
              </span>
            ))
          ) : (
            <div className="profile-hero-cards-empty">دو کارت مورد علاقه را انتخاب کنید</div>
          )}
        </div>
      </section>

      {/* Identity */}
      <section className="panel profile-section">
        <div className="profile-section-head">
          <span className="profile-section-icon" aria-hidden>♠</span>
          <h3 className="profile-section-title">هویت بازیکن</h3>
        </div>

        <Field label="نام نمایشی" htmlFor="displayName">
          <Input
            id="displayName"
            value={p.displayName}
            maxLength={40}
            onChange={(e) => set("displayName", e.target.value)}
          />
        </Field>

        <Field label="آواتار">
          <div className="profile-avatar-grid">
            {AVATARS.map((a) => (
              <button
                key={a}
                type="button"
                className={`profile-pick-btn${p.avatar === a ? " profile-pick-btn--active" : ""}`}
                onClick={() => set("avatar", p.avatar === a ? "" : a)}
                aria-label={`آواتار ${a}`}
                aria-pressed={p.avatar === a}
              >
                {a}
              </button>
            ))}
          </div>
        </Field>

        <Field
          label="لقب"
          htmlFor="title"
          counter={`${p.title.length.toLocaleString("fa")}/${TITLE_MAX.toLocaleString("fa")}`}
        >
          <Input
            id="title"
            value={p.title}
            maxLength={TITLE_MAX}
            placeholder="مثلاً سلطان بلوف"
            onChange={(e) => set("title", e.target.value)}
          />
        </Field>

        <Field
          label="شعار"
          htmlFor="tagline"
          counter={`${p.tagline.length.toLocaleString("fa")}/${TAGLINE_MAX.toLocaleString("fa")}`}
        >
          <Input
            id="tagline"
            value={p.tagline}
            maxLength={TAGLINE_MAX}
            placeholder="مثلاً بلوف تخصص منه"
            onChange={(e) => set("tagline", e.target.value)}
          />
        </Field>
      </section>

      {/* Cards */}
      <section className="panel profile-section">
        <div className="profile-section-head">
          <span className="profile-section-icon" aria-hidden>🃏</span>
          <h3 className="profile-section-title">
            کارت‌های مورد علاقه
            <span className="ui-counter" style={{ marginRight: "0.35rem" }}>
              ({p.favoriteCards.length.toLocaleString("fa")}/{MAX_FAVORITE_CARDS.toLocaleString("fa")})
            </span>
          </h3>
        </div>

        <div className="profile-card-rack" role="group" aria-label="انتخاب کارت مورد علاقه">
          {SUITS.map((_, s) => (
            <div key={SUITS[s]} className="profile-card-suit-row">
              {RANKS.map((r) => {
                const code = `${r}${SUITS[s]}`;
                const sel = p.favoriteCards.includes(code);
                const full = !sel && p.favoriteCards.length >= MAX_FAVORITE_CARDS;
                const label = r === "T" ? "10" : r;
                return (
                  <button
                    key={code}
                    type="button"
                    className={`profile-card-btn profile-card-btn--${RED.has(s) ? "red" : "black"}${sel ? " profile-card-btn--active" : ""}`}
                    onClick={() => toggleFavorite(code)}
                    disabled={full}
                    title={code}
                    aria-pressed={sel}
                  >
                    {label}
                    <br />
                    {SUIT_SYMBOLS[s]}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </section>

      {/* Table style */}
      <section className="panel profile-section">
        <div className="profile-section-head">
          <span className="profile-section-icon" aria-hidden>🎰</span>
          <h3 className="profile-section-title">سبک میز</h3>
        </div>

        <div className="ui-field">
          <div className="ui-label"><span>پشت کارت</span></div>
          <div className="profile-backs" role="group" aria-label="انتخاب پشت کارت">
            {CARD_BACKS.map((cb) => (
              <button
                key={cb.id}
                type="button"
                className={`profile-back-btn${p.cardBack === cb.id ? " profile-back-btn--active" : ""}`}
                style={{ background: cb.color }}
                onClick={() => set("cardBack", p.cardBack === cb.id ? "" : cb.id)}
                title={cb.name}
                aria-pressed={p.cardBack === cb.id}
                aria-label={cb.name}
              />
            ))}
          </div>
        </div>

        <div className="ui-field">
          <div className="ui-label"><span>رنگ ژتون</span></div>
          <div className="profile-chips" role="group" aria-label="انتخاب رنگ ژتون">
            {CHIP_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`profile-chip-btn${p.chipColor === c ? " profile-chip-btn--active" : ""}`}
                style={{ background: c }}
                onClick={() => set("chipColor", p.chipColor === c ? "" : c)}
                aria-pressed={p.chipColor === c}
                aria-label={`رنگ ژتون ${c}`}
              />
            ))}
          </div>
        </div>

        <div className="ui-field">
          <div className="ui-label">
            <span>ایموت‌های سریع</span>
            <span className="ui-counter">{p.emotes.length.toLocaleString("fa")}/{MAX_EMOTES.toLocaleString("fa")}</span>
          </div>
          <div className="profile-emote-grid">
            {EMOTES.map((e) => (
              <button
                key={e}
                type="button"
                className={`profile-pick-btn${p.emotes.includes(e) ? " profile-pick-btn--active" : ""}`}
                onClick={() => toggleEmote(e)}
                aria-pressed={p.emotes.includes(e)}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      </section>

      <label className="profile-toggle">
        <input
          type="checkbox"
          checked={p.statsPublic}
          onChange={(e) => set("statsPublic", e.target.checked)}
        />
        نمایش آمار من به دیگران
      </label>

      <div className="profile-save-bar">
        <button className="btn btn-primary" onClick={save} disabled={saving} style={{ minWidth: "6.5rem" }}>
          {saving ? "در حال ذخیره…" : "ذخیره پروفایل"}
        </button>
        {msg && (
          <span className={`profile-save-msg${msg.includes("✓") ? " profile-save-msg--ok" : " profile-save-msg--err"}`}>
            {msg}
          </span>
        )}
      </div>
    </PageShell>
  );
}
