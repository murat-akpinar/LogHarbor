# Cascadia Nerd Font — self-hosted UI font

Date: 2026-07-15
Status: approved (approach A)

## Goal

Replace Inter Variable (sans) and JetBrains Mono Variable (mono) with the user's local
CaskaydiaMono Nerd Font across the entire UI. Fonts are embedded in the repo and bundled
by Vite — no runtime or build-time network fetch for fonts.

## Decisions

- **Variant:** `CaskaydiaMonoNerdFontMono` (Nerd "Mono" build: icon glyphs constrained to
  one cell) — keeps column alignment in the event list intact if icon glyphs ever appear
  in log content.
- **Weights:** only two files are needed. The UI uses Tailwind `font-medium` (500) and
  `font-semibold` (600); `font-bold` and italics are unused. Cascadia ships no 500 weight.
  - `CaskaydiaMonoNerdFontMono-Regular.ttf` → `font-weight: 400`
  - `CaskaydiaMonoNerdFontMono-SemiBold.ttf` → `font-weight: 500 700`
  - Consequence: `font-medium` and `font-semibold` render identically (SemiBold).
- **Format:** WOFF2 (~1.2 MB/file, down from 2.8 MB TTF). Converted losslessly with
  fontTools (`TTFont(...).flavor = 'woff2'`); the tooling was installed temporarily for
  the conversion and removed afterwards — it is not a build dependency. The app still
  serves fonts same-origin with no network fetch.
- **License:** the Nerd Fonts `LICENSE` (OFL) is copied next to the font files, as OFL
  requires when redistributing.

## Changes

1. `frontend/src/assets/fonts/` — two TTFs + `LICENSE` + `fonts.css` (`@font-face`,
   family `"CaskaydiaMono NF"`, `font-display: swap`).
2. `frontend/src/main.tsx` — drop the two `@fontsource-variable` imports, import
   `./assets/fonts/fonts.css`.
3. `frontend/src/index.css` — `--font-sans` and `--font-mono` both become
   `"CaskaydiaMono NF"` with `ui-monospace, monospace` fallback. The Inter-specific
   `font-feature-settings: "cv05", "ss03"` on `body` is removed (those tags don't exist
   in Cascadia; its default glyphs already disambiguate 1lI0O).
4. `frontend/package.json` — remove `@fontsource-variable/inter` and
   `@fontsource-variable/jetbrains-mono`.

## Verification

- `npm run build` succeeds; `dist/assets` contains the two hashed `.ttf` files and the
  built CSS references them.
- Served app loads the font same-origin with no external requests.
