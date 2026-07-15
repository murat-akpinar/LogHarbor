# Frontend Redesign — Design

Date: 2026-07-14
Status: approved

## Problem

The SPA looks templated. The palette is Tailwind defaults (`slate` greys, `blue-600`
accent, `red` errors) hardcoded across ~40 files, typography is the system font stack at
six unplanned size/weight combinations, and text hierarchy has collapsed onto a single
muted grey. There is no token layer, so a palette change means a find-and-replace across
the codebase.

Goal: a deliberate visual identity in the Linear/Vercel register — calm neutral surfaces,
thin borders, careful typography, one confident accent — without changing any behaviour,
adding pages, or introducing a component framework.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Direction | Modern SaaS (Linear/Vercel) | Professional, medium density, reads well in long sessions |
| Accent | Emerald | Distinct from the red/amber status colours; carries the "technical tool" feel |
| Default theme | System preference | Both themes are first-class, neither is an afterthought |
| Fonts | Inter (UI) + JetBrains Mono (data) | Self-hosted via `@fontsource-variable/*`; no external CDN request |
| Approach | Semantic token layer, then a component pass | Single source of truth; a future palette change is one file |

Rejected: a pure colour find-and-replace (leaves the colours scattered and fixes none of
the typography or density problems); adopting shadcn/ui (new dependencies and a very large
diff for 19 components, and it does not supply the custom ones like `VirtualizedEventList`).

## Token layer

Tokens live in `frontend/src/index.css`. Raw Tailwind colour utilities (`bg-slate-900`,
`text-blue-600`) must not appear in components after this work.

Tailwind v4's `@theme` cannot switch on a class, so the values are declared as CSS custom
properties on `:root` / `:root.dark` and `@theme` maps them into utility names:

```css
@theme {
  --color-bg: var(--logharbor-bg);
  --color-surface: var(--logharbor-surface);
  /* ... */
}
```

This yields `bg-bg`, `bg-surface`, `text-fg-muted`, `border-border`, `bg-accent` etc.

### Surfaces (three layers, not one flat grey)

| Token | Light | Dark |
|---|---|---|
| `bg` (page) | `#F7F8F8` | `#0B0C0E` |
| `surface` (panel, card, row group) | `#FFFFFF` | `#131518` |
| `surface-hover` | `#F1F2F3` | `#17191D` |
| `surface-raised` (dropdown, modal, selected row) | `#E9EBEE` | `#1B1E23` |

Dark is a cool near-black, not pure black (harsh on OLED) and not grey (lifeless).

### Borders

| Token | Light | Dark |
|---|---|---|
| `border` (default separator) | `#E4E6E8` | `#262A30` |
| `border-strong` (inputs, focus, emphasis) | `#C9CDD2` | `#3A3F47` |

### Text (three levels of hierarchy)

| Token | Light | Dark |
|---|---|---|
| `fg` (body) | `#16181B` | `#E8EAED` |
| `fg-muted` (labels, timestamps) | `#5B6169` | `#9BA1A9` |
| `fg-subtle` (placeholders, secondary counts) | `#8B9199` | `#6B717A` |

### Accent

| Token | Light | Dark |
|---|---|---|
| `accent` | `#059669` | `#34D399` |
| `accent-hover` | `#047857` | `#6EE7B7` |
| `accent-fg` (text on accent) | `#FFFFFF` | `#04120C` |

The same hex never looks the same in both themes, so the accent is tuned per theme rather
than reused. Accent means *interactive or live*: primary buttons, active tab, focus ring,
the live-tail indicator, histogram bars.

### Level colours (kept entirely separate from the accent)

| Level | Light | Dark |
|---|---|---|
| Fatal | `#BE123C` | `#FB7185` |
| Error | `#DC2626` | `#F87171` |
| Warning | `#B45309` | `#FBBF24` |
| Information | `#52627A` | `#8FA3B8` |
| Debug | `#6B7280` | `#7C8590` |
| Verbose | `#94A3B8` | `#5F6771` |

Information stays a cool neutral rather than a colour. Most events are Information; if
every level is coloured, none of them is. The eye must land on Warning and Error.

Error rows additionally get a very faint red row tint (~6% alpha) so scanning a long list
surfaces them without reading.

### Radius, shadow, motion

Radius: cards `10px`, inputs and buttons `8px`, badges fully round.
Shadow: light theme uses soft layered shadows; dark theme uses borders plus a faint inner
highlight, because drop shadows do not read on a near-black background.
Motion: 120–160ms `ease-out` on hover/focus transitions. The existing live-tail arrival
flash keyframe is recoloured to the accent and shortened from 1.5s to 900ms — at a fast
arrival rate the current duration makes the list shimmer.

## Typography

Both fonts ship inside the bundle (`@fontsource-variable/inter`,
`@fontsource-variable/jetbrains-mono`). Variable fonts, so one file covers every weight;
roughly 180KB combined, hashed and cached by Vite. No request ever leaves the host, which
matters on the intranet where a CDN may be unreachable.

- **Inter** — UI: navigation, buttons, form labels, card titles, prose.
  `font-feature-settings: 'cv05', 'ss03'` (straight `l`, single-storey `a`) to reduce
  `1lI0O` confusion, which matters in a log tool.
- **JetBrains Mono** — data: timestamps, the log message itself, the JSON tree in
  `EventDetail`, exception stack traces, the filter expression input, API keys. Today these
  fall back to whatever monospace the OS provides, so alignment differs per machine.
- **`tabular-nums`** on timestamps, counters and chart axes. Without it the timestamp column
  jitters while the list scrolls.

Scale (deliberately narrow): `text-xs` 11px (meta), `text-sm` 13px (body and lists — the
default), `text-base` 15px (card titles), `text-lg` 18px (page titles). Weights 400/500/600
only.

Line height: ~1.4 in the event list (density is only needed there), 1.6 in prose, help text
and forms — squeezing settings screens reads as cramped, not crafted.

## Component pass

No new pages, no behaviour change, no new dependency beyond the two fonts.

**Shell (`NavBar`)** — product name plus version on the left, tabs centred, theme toggle and
user menu on the right. The active tab becomes a soft `surface-raised` pill rather than an
underline. Height drops to 48px.

**Events page header** — the current single row of six controls is split in two: a
full-width search bar on top (monospace, accent focus ring), and below it a 32px filter
strip on `surface` holding the level chips, signal toggles, time range, column picker,
export links and the live-tail toggle.

**`EventRow`** — the most important component. The level moves from a filled badge to a 2px
coloured bar on the left edge plus a short code (`ERR`, `WRN`). Timestamps are monospace and
`fg-muted`. Message text is `fg`, with template variables (`{OrderId}`) subtly emphasised —
they carry the entire value of a structured log and are currently rendered as plain text.
Fixed row height (virtualization requires it), `surface-hover` on hover, `surface-raised`
plus an accent left bar when selected.

**`EventDetail`** — header with level, timestamp and a copy button; properties as a table
(name in `fg-muted`, value in monospace `fg`); the JSON tree is reserved for nested values;
exception last.

**`Dashboard` / `Analysis`** — the histogram keeps its per-level stacked bands, recoloured from
`LEVEL_HEX`. The whole point of the chart is that a Warning spike is visible without hovering,
so the levels must stay separable — an earlier draft of this spec called for collapsing them
into an accent band plus an error band, which threw that away. `StatTile` becomes a card: large
`tabular-nums` figure (24px), label beneath. The heatmap moves to an emerald → amber → red scale.

**Forms (`Signals`, `Alerts`, `Settings`, `LoginGate`)** — extract shared `Button`, `Input`
and `Card` components; the same Tailwind class soup is currently copy-pasted in ~20 places.
Button variants: `primary` (accent), `secondary` (bordered), `danger` (red, destructive
actions only). `LoginGate` becomes a single centred card over a very faint emerald gradient —
it is the first screen a user sees and the highest-leverage place to spend effort.

**Empty and loading states** — skeleton rows replace the current `Loading…` text; an empty
result shows a centred message with a "clear the filter" affordance.

## Theme default

`useTheme` currently defaults to a stored choice. It gains a third state: follow
`prefers-color-scheme` unless the user has explicitly chosen a theme. The explicit choice
still persists in localStorage; the toggle behaviour is unchanged.

## Out of scope

Layout of the page grid itself, new visualisations, responsive/mobile work beyond what
already exists, i18n, and any backend change.

## Verification

The frontend has no test suite, so verification is: `npx tsc --noEmit` clean;
`npm run build` succeeds and the font files appear as hashed assets; the project's `verify`
skill boots the backend with the built SPA and every page is walked in both themes with
screenshots; `dotnet test backend` stays green (nothing here touches it).
