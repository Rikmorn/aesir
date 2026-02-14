# Aesir Dashboard Design System

## Direction & Feel

**Intent:** Operations dashboard for monitoring autonomous AI agents. The person using this built these agents — it should feel like sitting at the console of something powerful. Dark, precise, authoritative.

**Temperature:** Cool but soft. Blue-gray undertones on every surface. Not harsh — easy on the eyes across long sessions.

**Density:** High. Information-dense with clear hierarchy. Monospace for data, tight spacing, compact headers.

**Not:** Playful, warm, decorative, marketing-adjacent. No gratuitous color, no soft shadows, no rounded-everything.

## Color Palette

OKLCH color space throughout. All surfaces share hue 265 (blue) at very low chroma for cohesive cool-toned feel.

### Dark Mode (Primary)

Lifted floor (0.155 not near-black), softened foreground (0.88 not bright white). Reduces contrast for comfortable extended use.

| Token | Value | Purpose |
|-------|-------|---------|
| background | `oklch(0.155 0.007 265)` | Lifted dark surface |
| card | `oklch(0.185 0.007 265)` | Card/panel surface |
| popover | `oklch(0.205 0.008 265)` | Floating elements |
| border | `oklch(0.255 0.01 265)` | Subtle cool border |
| foreground | `oklch(0.88 0.005 265)` | Primary text (soft white) |
| muted-foreground | `oklch(0.52 0.015 265)` | Secondary text |
| primary | `oklch(0.60 0.16 250)` | Indigo accent — signal color |
| destructive | `oklch(0.55 0.22 25)` | Error red |
| sidebar | `oklch(0.14 0.007 265)` | Sidebar (slightly deeper) |

### Light Mode

Soft off-white background, not stark. Cards are warm white, not pure white. Foreground is softened charcoal.

| Token | Value | Purpose |
|-------|-------|---------|
| background | `oklch(0.965 0.004 265)` | Soft off-white |
| card | `oklch(0.985 0.002 265)` | Warm white cards |
| border | `oklch(0.895 0.005 265)` | Soft cool border |
| foreground | `oklch(0.175 0.01 265)` | Softened charcoal text |
| muted-foreground | `oklch(0.47 0.015 265)` | Secondary text |

### Status Colors (Dark Mode)

| Status | Background | Text | Dot |
|--------|-----------|------|-----|
| Running/Active | `indigo-500/10` | `indigo-400` | `indigo-500` + pulse |
| Waiting/Paused | `amber-500/10` | `amber-400` | `amber-500` |
| Completed | `emerald-500/10` | `emerald-400` | `emerald-500` |
| Failed | `red-500/10` | `red-400` | `red-500` |
| Queued/Created | `muted` | `muted-foreground` | `muted-foreground` |

### Chart Colors

1. Indigo (`oklch(0.60 0.16 250)`) — primary signal
2. Teal (`oklch(0.65 0.15 165)`) — success/completion
3. Amber (`oklch(0.65 0.15 55)`) — waiting
4. Violet (`oklch(0.58 0.18 300)`) — escalation
5. Red (`oklch(0.55 0.20 25)`) — failure

## Depth Strategy

**Borders-only for grounded elements.** No shadows on cards, panels, or sidebars. Flat, etched surfaces. Border opacity is low — structure without demanding attention.

**Shadows allowed for floating elements:** popovers, dialogs, tooltips, select dropdowns, and overlay pills. These are genuinely detached from the surface and need the depth cue.

- Cards: `border` only (no `shadow-sm`)
- Panels: border separation
- Sidebar: same color family as canvas, separated by border
- Task detail panel: `border-l` only
- Buttons: no `shadow-xs` — borders-only
- Popovers/Dialogs/Tooltips: `shadow-md` or `shadow-lg` (floating elements)

## Typography

- **Sans:** Inter (via `next/font/google`, variable `--font-sans`)
- **Mono:** JetBrains Mono (via `next/font/google`, variable `--font-mono`)
- **Data values:** Always `font-mono tabular-nums` — numbers align
- **Hero metric:** `font-mono text-3xl font-semibold tabular-nums tracking-tight` — dominant number
- **Secondary metric:** `font-mono text-2xl font-semibold tabular-nums` — supporting numbers
- **Page headers:** `text-lg font-semibold tracking-tight` — compact authority
- **Page subtitles:** `text-[13px] text-muted-foreground` — understated
- **Table headers:** `text-xs font-medium uppercase tracking-wider text-muted-foreground`
- **Metadata labels:** `text-xs font-medium text-muted-foreground`

## Spacing

- **Base unit:** 4px (Tailwind default)
- **Page padding:** `px-6 py-6`
- **Header to content:** `mb-5`
- **Card grid gap:** `gap-3` to `gap-4`
- **Section spacing:** `space-y-5`

## Border Radius

- **Base:** `0.5rem` (8px)
- **Cards:** `rounded-lg` (8px)
- **Buttons/Inputs:** `rounded-md` (6px)
- **Badges:** `rounded-full`
- **Task nodes:** `rounded-md`

## Status Indicators

All status indicators use the dot + tinted background pattern:

```tsx
<Badge variant="outline" className="gap-1.5 border-transparent font-medium bg-indigo-500/10 text-indigo-400">
  <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-pulse-signal" />
  Running
</Badge>
```

- Standard dot: `h-1.5 w-1.5` (6px)
- Hero dot (stat card primary): `h-2 w-2` (8px)
- Active states pulse via `animate-pulse-signal` (2s ease-in-out)
- Always use `emerald-500` for success (never `green-500`)

## Connection Status

The SSE connection indicator uses the same dot + tinted pill pattern as status badges, but rendered as a standalone pill with `rounded-full` and `px-2.5 py-1` padding. Connection state is critical infrastructure on a live dashboard — it gets visual weight matching its importance.

- Connected: emerald pill with pulsing dot, "Live"
- Disconnected: red pill, "Offline"
- Reconnecting: amber pill, "Reconnecting"

## Empty States

No dashed borders. Empty states are information — the system is idle, clean, or unreachable. Text alone, centered, reduced height (`h-[120px]`). The empty state is a status, not a placeholder.

## Stat Card Hierarchy

Not all metrics are peers. Running is the primary metric on a monitoring dashboard — "how many agents are active right now?" is the question you came to answer.

- **Running** (hero): larger dot (`h-2 w-2`), larger number (`text-3xl`), more vertical padding (`py-4`), spans full width on mobile (`col-span-2 md:col-span-1`)
- **Secondary stats** (waiting, queued, completed, failed): standard dot, standard number (`text-2xl`), compact padding (`py-3`)

## Sidebar

- Active state: `bg-primary/15 text-primary` — visible without being loud
- Hover: `hover:bg-accent hover:text-foreground`

## Signature Element

The delegation graph — task nodes represent autonomous agents with:
- Status-colored border (2px)
- Entity name, summary, status dot + monospace elapsed time
- Active edges animate (indigo circle traveling the path)
- Minimap uses matching status colors

## Key Components

### Page Headers

Consistent across all pages:
```tsx
<div className="px-6 py-6">
  <div className="mb-5">
    <h1 className="text-lg font-semibold tracking-tight">Title</h1>
    <p className="mt-0.5 text-[13px] text-muted-foreground">Subtitle</p>
  </div>
```

### Agent Cards

Grid layout, `hover:border-foreground/25` for clear affordance, type badge with dot, monospace ID.

### Tables

Uppercase tracking-wider headers in muted-foreground. Compact rows. Monospace for IDs and durations.
