/** Identity / data-viz tones. Colour never carries meaning alone: every use also has a label. */
export type VizTone = "indigo" | "violet" | "fuchsia" | "rose" | "amber" | "emerald" | "cyan" | "sky";

export const TONE_VAR: Record<VizTone, string> = {
  indigo: "var(--color-viz-indigo)",
  violet: "var(--color-viz-violet)",
  fuchsia: "var(--color-viz-fuchsia)",
  rose: "var(--color-viz-rose)",
  amber: "var(--color-viz-amber)",
  emerald: "var(--color-viz-emerald)",
  cyan: "var(--color-viz-cyan)",
  sky: "var(--color-viz-sky)",
};

/** Static class strings (Tailwind can only see literal class names). */
export const TONE_CLASS: Record<VizTone, { chip: string; glow: string; edge: string; text: string }> = {
  indigo: { chip: "bg-viz-indigo/12 text-viz-indigo ring-viz-indigo/25", glow: "bg-viz-indigo/25", edge: "via-viz-indigo/60", text: "text-viz-indigo" },
  violet: { chip: "bg-viz-violet/12 text-viz-violet ring-viz-violet/25", glow: "bg-viz-violet/25", edge: "via-viz-violet/60", text: "text-viz-violet" },
  fuchsia: { chip: "bg-viz-fuchsia/12 text-viz-fuchsia ring-viz-fuchsia/25", glow: "bg-viz-fuchsia/25", edge: "via-viz-fuchsia/60", text: "text-viz-fuchsia" },
  rose: { chip: "bg-viz-rose/12 text-viz-rose ring-viz-rose/25", glow: "bg-viz-rose/25", edge: "via-viz-rose/60", text: "text-viz-rose" },
  amber: { chip: "bg-viz-amber/12 text-viz-amber ring-viz-amber/25", glow: "bg-viz-amber/20", edge: "via-viz-amber/60", text: "text-viz-amber" },
  emerald: { chip: "bg-viz-emerald/12 text-viz-emerald ring-viz-emerald/25", glow: "bg-viz-emerald/22", edge: "via-viz-emerald/60", text: "text-viz-emerald" },
  cyan: { chip: "bg-viz-cyan/12 text-viz-cyan ring-viz-cyan/25", glow: "bg-viz-cyan/22", edge: "via-viz-cyan/60", text: "text-viz-cyan" },
  sky: { chip: "bg-viz-sky/12 text-viz-sky ring-viz-sky/25", glow: "bg-viz-sky/22", edge: "via-viz-sky/60", text: "text-viz-sky" },
};
