# 08 · Design system

> **Updated spec:** `docs/design-system.md` (tokens v2, components, states, test IDs) and `docs/ux-guidelines.md` (flows, copy, errors, a11y) supersede this page where they differ. Notable changes: `faint` is now `#868D86` (AA), new `border-control` `#646C63` for inputs and secondary buttons, new `info` tone, and the "verifiers" bucket is called **AI verification**.

Look: dark trading terminal. Near-black ground, one lime accent, monospace for numbers and labels, thin 1px borders instead of shadows. Inspired by Tensor / Magic Eden density and pump.fun energy, but calmer and trust-forward.

## Color tokens

| Token           | Hex                   | Use                                                     |
| --------------- | --------------------- | ------------------------------------------------------- |
| `bg`            | `#0A0B0A`             | Page background                                         |
| `bg-inset`      | `#0E100E`             | Code blocks, inputs, ticker bar, trust strip cells      |
| `surface`       | `#121412`             | Cards, panels, table header                             |
| `surface-2`     | `#161916`             | Active nav pill, list rows                              |
| `border`        | `#262A26`             | Card borders, inputs                                    |
| `border-soft`   | `#1E221E`             | Dividers, header bottom border                          |
| `border-strong` | `#343A34`             | Secondary button borders                                |
| `text`          | `#EDEFEA`             | Primary text                                            |
| `text-2`        | `#B4BAB2`             | Body copy on dark                                       |
| `muted`         | `#9BA19A`             | Labels, meta                                            |
| `faint`         | `#6E756D`             | Code comments, fine print only (not for essential text) |
| `accent`        | `#C6F432`             | Primary buttons, verified, pass, links                  |
| `accent-hover`  | `#DDFF7A`             | Link hover                                              |
| `on-accent`     | `#0A0B0A`             | Text on accent                                          |
| `accent-bg`     | `#141A08`             | Holder/verified panels                                  |
| `accent-border` | `#2E3A12`             | Borders of accent panels/pills                          |
| `accent-muted`  | `#9FAF86` / `#C9D0BE` | Labels / body text inside accent panels                 |
| `warn`          | `#F5A524`             | Warnings, in review, filter values                      |
| `warn-bg`       | `#1C160A`             | Warning rows                                            |
| `warn-border`   | `#3A2C0E`             | Flagged code panel                                      |
| `danger`        | `#FF8A7A`             | Fail flags                                              |

Category accents (used for the code label + card header tint):

| Category     | Text      | Card header bg |
| ------------ | --------- | -------------- |
| Userscripts  | `#C6F432` | `#141A10`      |
| Wallet lists | `#7CC4FF` | `#0F1620`      |
| Filters      | `#F5A524` | `#1C160A`      |
| Setups       | `#C9A2FF` | `#18121F`      |
| Strategies   | `#6EE7C8` | `#0E1A17`      |
| Alerts       | `#FF8A7A` | `#1F1210`      |

Revenue split bar colors: buyback `#C6F432`, AI verification `#7CC4FF`, ops `#C9A2FF`, safety `#F5A524`, all with `#0A0B0A` text.

## Typography

- **Geist** (UI) and **Geist Mono** (prices, hashes, labels, tags, code). Google Fonts or `geist` npm package.
- Scale: hero `clamp(40px, 6vw, 68px)` / 700 / −0.035em / line-height 1.02 · H1 page 40–44px / −0.03em · H2 section 28px / −0.02em · H3 card 18–22px · body 15px/1.5 · lead 17–18px · meta 13px · mono labels 11–12px uppercase-ish codes (`01 / SCRIPTS`, `USERSCRIPT`, `VERIFIED`).
- Prices always mono, 600 weight.

## Spacing & shape

- 4px base. Common: 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 48, 64, 72.
- Content max-width 1280px, side gutter 24px (16px on phone).
- Radius: pills 999px · tags 6px · buttons/inputs 10px · cards 14px · big panels 16px · avatar 50%.
- No shadows. Elevation = surface color + border.
- Touch targets ≥ 44px (primary buttons 44–52px tall).

## Components (build these in `apps/web/components`)

| Component          | Spec                                                                                                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TopTicker`        | 12px mono, bg-inset, live dot (accent), token price, rebate line, right-aligned trust line                                                                                                         |
| `NavBar`           | logo tile 32px accent with chart glyph, wordmark "trenchmart" 700 18px; nav pills; search (44px, `/` hint); tier chip (accent-bg/border, mono 12px); wallet button (accent, truncated `7xKp…a9Fq`) |
| `Button`           | variants: `primary` (accent/on-accent, 600), `secondary` (transparent, border-strong), `ghost`; sizes 36/44/48/52                                                                                  |
| `Tag`              | mono 11px, 3–4px × 8px, radius 6px; variants: category, verified (accent + accent-border), terminal (surface + border)                                                                             |
| `Badge`            | `✓ VERIFIED` accent, `◷ IN REVIEW` warn                                                                                                                                                            |
| `ListingCard`      | 120px tinted header (category tag left, badge right, compat line bottom) + body (title 600, `by @x · ★ 4.9 · 412 sold`, price mono 17px, `holders 1.20` accent 12px)                               |
| `CategoryCard`     | code label in category color, name 16px 600, desc 13px muted                                                                                                                                       |
| `TrustStrip`       | 4 cells separated by 1px gaps, icon 22px accent stroke, title + 13px desc                                                                                                                          |
| `TerminalFilter`   | pill toggle group, `aria-pressed`, active = accent fill                                                                                                                                            |
| `CodeWindow`       | 3 dots, filename, status right; pre mono 13px/1.7 on bg-inset; comment `#6E756D`, values `#F5A524`, pass notes accent                                                                              |
| `SecuritySummary`  | accent-bg panel, shield icon 40px, "Passed · 9 of 9 checks", verifier line, attestation link                                                                                                       |
| `CheckItem`        | 22px square status (pass accent ✓ / warn amber ! / fail danger ×), title 14px 600, detail 13px muted                                                                                               |
| `PermissionsTable` | 4 columns mono: @match, @grant, @connect, sha256                                                                                                                                                   |
| `BuyBox`           | total mono 34px, tier preview pills (4), fee breakdown rows mono 13px, primary 52px button, escrow note with lock icon, license fine print                                                         |
| `CreatorCard`      | avatar 44px, handle, meta, 2×2 stat tiles (bond, disputes lost, identity, tier), report link                                                                                                       |
| `PipelineStepper`  | 5 cards; states done (accent-border/accent-bg/accent label), now (warn border/warn-bg), next (border/surface)                                                                                      |
| `ScanRow`          | like CheckItem but full-width row with right-aligned `PASS`/`WARN` mono label, warn rows get warn-bg                                                                                               |
| `FlaggedCode`      | warn-border panel, highlighted line `#2A1F08` bg / `#F5C46A` text, explain textarea, actions                                                                                                       |
| `FeeTable`         | scrollable box, mono header 12px, rows with discount column in accent                                                                                                                              |
| `SplitBar`         | 52px flex bar, segments proportional, labels inside                                                                                                                                                |
| `TierCard`         | selectable button card; requirement mono, name 26px 700, headline accent mono, perk list with `+`                                                                                                  |
| `SavingsCalc`      | spend pills, 3 mono stats                                                                                                                                                                          |

Icons: inline stroke SVG (2px, round caps), no emoji. `lucide-react` is fine as a source.

## Accessibility

- Text contrast ≥ 4.5:1 (all `text`, `text-2`, `muted` on `bg`/`surface` pass; `faint` only for non-essential text).
- Real `<button>`/`<a>`; toggle groups use `aria-pressed`; tabs use `role="tablist"`/`tab` + `aria-selected`.
- Visible focus ring: `outline: 2px solid #C6F432; outline-offset: 2px`.
- Pass/warn/fail always carries a symbol + word, never color alone.

## Tailwind config sketch

```ts
theme: { extend: {
  colors: {
    bg: '#0A0B0A', inset: '#0E100E', surface: '#121412', surface2: '#161916',
    line: { DEFAULT: '#262A26', soft: '#1E221E', strong: '#343A34' },
    ink: { DEFAULT: '#EDEFEA', 2: '#B4BAB2', muted: '#9BA19A', faint: '#6E756D' },
    lime: { DEFAULT: '#C6F432', hover: '#DDFF7A', bg: '#141A08', line: '#2E3A12' },
    warn: { DEFAULT: '#F5A524', bg: '#1C160A', line: '#3A2C0E' },
    danger: '#FF8A7A', sky: '#7CC4FF', violet: '#C9A2FF', teal: '#6EE7C8',
  },
  fontFamily: { sans: ['Geist', 'system-ui'], mono: ['Geist Mono', 'monospace'] },
  borderRadius: { tag: '6px', ctl: '10px', card: '14px', panel: '16px' },
}}
```

Machine-readable tokens: `design/tokens.json`.
