# LogHarbor Frontend

React 18 + TypeScript + Vite + Tailwind CSS. SPA served by the backend in production.

--- PAGES ---

/            Events page: search bar (with autocomplete), level filter chips, event
             list, live tail toggle, export (JSON/CSV)
/dashboard   Histogram chart + level summary cards for a time range
/analysis    Top errors (grouped by message template + level), top exception
             types, and operations slower than their own baseline, for a time
             range; rows deep-link to filtered Events
/signals     List, create, edit, delete signals
/alerts      List, create, edit, delete alert rules (signal + threshold -> webhook)
/settings    API key management, archive/retention settings, user management
             (admin only), health status, sign out

Auth is enabled automatically once at least one user account exists (LOGHARBOR_ADMIN_PASSWORD
seeds the first admin on startup). While enabled, a login screen (username + password)
gates the whole SPA until the session cookie is issued (GET /api/auth/status drives this).
Viewers see every page but mutating controls (create/edit/delete forms, API key and
archive-setting changes) are hidden; the Users section under Settings is admin-only.

--- FOLDER STRUCTURE ---

frontend/src/
  api/          typed API client (fetch wrappers per resource: events.ts, signals.ts, ...)
  components/   reusable UI (EventRow, EventDetail, LevelBadge, SearchBar, TimeRangePicker)
  pages/        EventsPage, DashboardPage, AnalysisPage, SignalsPage, AlertsPage, SettingsPage
  hooks/        useLiveTail (SignalR), useEventSearch (React Query), useTheme (dark mode)
  i18n/         typed TR/EN dictionaries (en.ts source of truth, tr.ts typed as Messages) + LanguageProvider/useI18n
  lib/          formatting helpers (dates, levels, colors, suggestContext)
  types/        Event, Signal, AlertRule, User, ApiKey, shared DTO types

--- LANGUAGES ---

The UI ships in English and Turkish. Language is detected from the browser on
first load (navigator.language startswith 'tr' -> Turkish), and an explicit
choice via the NavBar TR/EN toggle is persisted to localStorage
('logharbor-lang') and wins thereafter. Dates and numbers format with the
active language (Intl APIs). Not translated: log event data, level names,
query-language syntax and operator labels, and backend API messages.
Dictionaries live in src/i18n/ (en.ts is the source; tr.ts is typed as
Messages = typeof en, so a missing key is a compile error).

--- EVENTS PAGE ---

Search bar: filter expression input, validate on submit via /api/query/validate
Autocomplete: while typing a bare property name or a value after =/<>/like, the
  bar debounces a call to /api/search/suggest and shows a dropdown (arrow keys +
  enter to accept, escape/blur to dismiss); parsing lives in lib/suggestContext.ts
Export: JSON/CSV links next to the time range picker build a GET /api/events/export
  URL from the current filter/range; the browser handles the download natively
  via the response's Content-Disposition header, no fetch/blob code needed
Level chips: quick toggles appended to the filter (@Level = 'Error')
Search history: last 10 committed filters (localStorage) shown as a dropdown when
  the bar is focused and empty; clicking one re-applies it without re-validation
Event list: virtualized, newest first, infinite scroll via afterId keyset paging
Event row: timestamp, level badge (color-coded), rendered message
Custom columns: "Columns" picker adds event properties as extra list columns
  (localStorage, rendered client-side from each event's properties JSON)
Timestamps: toggle between absolute and relative ("2 min ago",
  Intl.RelativeTimeFormat, localStorage; relative view re-renders every 30s)
Keyboard shortcuts: / focuses search, j/k move the selection, Esc closes the
  detail panel, ? toggles a shortcut help overlay
Search term highlight: quoted free-text terms and contains values from the active
  filter are wrapped in <mark> (amber background) inside message and exception text;
  terms extracted client-side from the filter string, no backend involvement
Row click: expands EventDetail with a syntax-highlighted property tree (nested
  objects/arrays collapse via native details/summary; React text nodes only,
  log content is untrusted) + raw JSON
Live tail: toggle connects to /hubs/tail with current filter; new events prepend with highlight
Time range: picker sets from/to; live tail forces "now"
Archived range: banner "N days in this range are archived" with Extract button;
  polls hydration status, refreshes results when segments become hydrated

--- LEVEL COLORS ---

Colors come from theme tokens, not per-component Tailwind classes: --color-level-fatal,
--color-level-error, --color-level-warning, --color-level-information, --color-level-debug,
--color-level-verbose, defined once in src/index.css (see DESIGN TOKENS below) and consumed
via lib/levels.ts (LEVEL_TEXT for text, LEVEL_BAR for bars/badges, LEVEL_HEX for chart fills,
which can't read a CSS variable back).

Verbose and Debug are muted/desaturated -- low-signal levels should recede.
Warning is amber, Error is red, Fatal is a deeper red/rose so it still reads as worse than
Error next to it.
Information stays neutral, the same muted tone as body text: most events are Information,
and if every level carries color then none of them draws the eye, so color is reserved for
levels worth calling out.

--- DASHBOARD PAGE ---

Histogram: stacked bar chart of counts per level over time (/api/stats/histogram)
Summary cards: total events, errors, warnings for the selected range, plus a
"Top error" card (most frequent error template) linking to the Analysis page
Clicking a histogram bar navigates to Events page with that time slice as from/to
Dragging across two or more bars zooms the dashboard range into that slice
Heatmap: hour-of-day x day-of-week density grid (/api/stats/heatmap, UTC),
single-hue cells scaled by count, per-cell native title tooltip

--- ANALYSIS PAGE ---

Top errors table: /api/stats/top-errors grouped by (message template, level);
  a "new" badge marks groups that never occurred before the selected range
  (checked against a baseline top-errors query ending at the range start);
  each row shows a 24-bucket sparkline (/api/stats/histogram filtered to the
  row's template + level, colored by level)
Top exceptions table: /api/stats/top-exceptions grouped by exception type
Slower than usual table: /api/stats/slow-operations lists operation groups whose
  p95 of the Elapsed property in the range is >= factor x the group's own baseline
  p95 (its history before the range) — adaptive, no fixed threshold; columns are
  usual p95, now p95, x slower, count and a template-filtered sparkline. Empty when
  nothing regressed or when events carry no Elapsed duration property.
Row click (errors and slow operations): navigates to Events with
  @MessageTemplate = '...' and the range as from/to; EventsPage reads the ?filter=
  deep link on mount

--- ALERTS PAGE ---

List, create, edit, delete alert rules: title, signal, threshold count, window
(minutes), webhook URL, enabled toggle. Shows last-fired time and last error inline.
Read-only for viewers (list only; the create form and edit/delete buttons are admin-only).

--- DESIGN TOKENS ---

src/index.css is the single source of truth for color, radius, shadow and fonts. Custom
properties (--logharbor-*) hold the raw values per theme (:root for light, :root.dark for
dark); @theme maps them into the Tailwind utility names components actually use
(bg-surface, text-fg, text-level-error, rounded-card, shadow-card, font-sans, font-mono,
...). Components name a role, never a raw palette color (bg-slate-100, text-red-600, and
so on) -- changing the palette means editing this one file, nothing else. The only
exception is lib/levels.ts's LEVEL_HEX map, which mirrors the level tokens as raw hex for
chart fills that can't read a CSS variable back.

--- THEME ---

Light/dark toggle in the nav bar; useTheme persists the choice to localStorage
(falls back to the OS prefers-color-scheme on first visit) and toggles a `dark`
class on <html>. index.css defines every token twice, once under :root and once
under :root.dark (see DESIGN TOKENS above), so switching themes is just the
browser re-resolving those custom properties. Components only ever reach for the
token utility names -- none of them uses Tailwind's dark: variant, and none should;
if a component seems to need one, the token is wrong.

--- STATE RULES ---

Server state: React Query (queries keyed by [resource, params])
UI state: useState/useReducer inside pages
Live tail buffer: capped at 500 events in memory, oldest dropped

--- DEV SETUP ---

Vite dev server proxies /api and /hubs to http://localhost:5000
npm run dev in frontend/, dotnet run in backend/ simultaneously
