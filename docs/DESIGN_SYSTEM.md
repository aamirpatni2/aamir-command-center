# Design System

Premium dark interface: a dark foundation with carefully controlled colour. Source of truth: `apps/web/src/index.css`
(tokens) and `packages/ui` (components).

## Layers (back to front)
1. **Base**: `--color-base` #05060b.
2. **Ambient light** (on `body`, fixed): indigo glow top-left, violet top-right, faint cyan from below; a faint 56px grid that fades
   out from the top; fine grain to stop gradient banding.
3. **Glass surfaces**: the `glass` utility: translucent ink (`--color-surface`), top-lit gradient, 18px backdrop blur,
   hairline border (`--color-line`), soft layered shadow (`--shadow-card`). Used by `Card`, `StatTile` and the login form.
4. **Content**: text in `ink` / `ink-2` / `ink-3` (all meet WCAG AA on the surfaces).

## Colour: controlled accents
| Role | Tokens | Use for | Never for |
|---|---|---|---|
| Brand | `brand-1` → `accent-strong` gradient, `accent` | primary buttons, active nav, links, focus | decoration everywhere |
| Status | `status-good/warning/serious/critical` | state badges and alerts, always with icon + label | charts, identity |
| Data viz / identity | `viz-indigo, violet, fuchsia, rose, amber, emerald, cyan, sky` | charts, stat-tile tones, agent chips | meaning without a label |

Agent identity colours live in `apps/web/src/lib/agents.ts` (Orchestrator indigo, Sales emerald, WhatsApp cyan, Content fuchsia,
Research sky, Student amber, Marketing rose, Analytics/Course violet).

## Typography
- Display: **Plus Jakarta Sans** (page titles, card titles, big numbers). Page titles use a subtle white→ink gradient.
- UI/body: **Inter** with `cv11, ss01, ss03`. Numbers use `tabular` figures.
- Code / tool names: **JetBrains Mono**.
- Urdu: **Noto Nastaliq Urdu**, downloaded only when Urdu glyphs render.
- All fonts are self-hosted (Fontsource): no third-party requests.

## Components (`@acc/ui`)
- `Card` (glass; `interactive` = hover lift + glow; `icon`, `title`, `action`).
- `StatTile` (`tone`, `hero`, `loading` shimmer; tone glow + lit top edge; lifts when wrapped in a `group` link).
- `Button` (primary gradient with glow, secondary glass, ghost, danger; press scale).
- `Field` / `fieldClass` (recessed input with accent focus glow), `StatusBadge`, `EmptyState` (glowing icon tile).
- Charts: `AreaChart` (smooth lines, gradient fill, draw-in, hover crosshair + tooltip, legend toggles that rescale the axis),
  `DonutChart` (hover to focus a segment), `BarList` (grow-in bars), `Meter` (inline score bar).
  Rules: real data only; every series labelled with its value; `role="img"` + an sr-only table.

## Motion
Page sections fade up on entry; cards lift on hover; buttons compress on press; charts draw in; the "Live" dot pulses.
Durations 150–500 ms with ease-out. `prefers-reduced-motion` disables all of it.

## Layout
Sidebar 256px glass panel (active item: gradient wash + glowing accent bar). Content max width 1280px, generous padding,
4px grid (gaps of 16px between cards). Mobile: sticky glass header + slide-in drawer; tiles go 2-up, charts full width.
