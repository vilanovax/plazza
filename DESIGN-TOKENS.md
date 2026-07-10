# Design Tokens — Poker PWA

Design system for the online poker PWA. Tokens live in `src/app/globals.css` (`:root`). Shared UI primitives live in `src/components/ui/`.

## Color

| Token | Value | Usage |
|-------|-------|--------|
| `--color-felt-900` … `--color-felt-400` | Green scale | Background, table felt |
| `--color-gold-500` | `#d9b45b` | Titles, prizes, turn highlight |
| `--color-gold-300` | `#f0d48a` | Soft gold text |
| `--color-accent-600` | `#2f9e6f` | Primary actions, success |
| `--color-accent-400` | `#7ee4b8` | Success text, active pills |
| `--color-danger-500` | `#e5484d` | Errors, fold, all-in |
| `--color-danger-300` | `#ff9aa0` | Soft error text |
| `--color-text` | `#eef2f6` | Body text |
| `--color-muted` | `#9fb0c0` | Labels, secondary |
| `--color-rail` | `#5b3b1e` | Table rail |

**Legacy aliases** (still supported): `--felt`, `--gold`, `--accent`, `--danger`, `--muted`, `--text`, `--card-border`.

## Surfaces

| Token | Usage |
|-------|--------|
| `--surface-inset` | Inputs, inset areas |
| `--surface-panel` | `.panel` cards |
| `--surface-elevated` | Headers, modals |

## Typography

| Token | Size |
|-------|------|
| `--text-xs` | 0.68rem |
| `--text-sm` | 0.78rem |
| `--text-base` | 0.9rem |
| `--text-lg` | 1.05rem |
| `--text-xl` | 1.25rem |

Font: `--font-body` → Vazirmatn Variable.

## Spacing & radius

`--space-1` (4px) … `--space-6` (24px)  
`--radius-sm` (8px) … `--radius-xl` (20px)

## Components

| Component | Path | Use for |
|-----------|------|---------|
| `PageShell` | `ui/PageShell` | Page wrapper |
| `PageHeader` | `ui/PageHeader` | Back + title |
| `Modal` | `ui/Modal` | Dialogs |
| `Input` / `Select` | `ui/Input` | Forms |
| `Field` | `ui/Field` | Label + input |
| `LoadingScreen` | `ui/LoadingScreen` | Async states |

## CSS classes

- **Layout:** `.page-shell`, `.table-shell`, `.lobby`
- **Cards:** `.panel`, `.meta-pill`, `.empty-state`
- **Buttons:** `.btn`, `.btn-primary`, `.btn-gold`, `.btn-ghost`, `.btn-danger`
- **Forms:** `.ui-input`, `.ui-field`, `.ui-label`, `.ui-counter`
- **Status pages:** `.status-page`, `.status-card`, `.status-title`, `.status-desc`
- **Table:** `.table-felt`, `.seat-panel`, `.table-pot`
- **Modals:** `.modal-backdrop`, `.modal-card`

## Rules

1. Prefer tokens over hardcoded hex in new code.
2. Use `PageShell` + `PageHeader` on every page.
3. Use `Modal` for overlays — never nest modals inside animated containers.
4. Use `LoadingScreen` instead of plain “در حال بارگذاری…”.
5. Page entrance: `page-fade-in` only (no `transform` on page roots).
6. Use `Input` / `Field` components — do not add `.profile-input` or `.create-input` aliases.

## Tailwind

Tailwind v4 is imported in `globals.css` (`@import "tailwindcss"`). **Keep it** — legacy Vita health pages (`/today`, `/diet`, `/chat`, etc.) still use Tailwind utility classes.

**Poker pages** use the token-based CSS system above (`.panel`, `.btn`, `.ui-input`, etc.). Do not mix Tailwind utilities into poker UI unless migrating that page fully.
