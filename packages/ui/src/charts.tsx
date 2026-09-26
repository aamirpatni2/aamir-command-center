/**
 * Lightweight SVG charts (no chart library). Rules:
 * - they render real data only; callers show an EmptyState when there is nothing to plot;
 * - colour is never the only carrier of meaning: every series has a label and a value in the legend;
 * - each chart has an accessible name and a screen-reader table with the same numbers.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "./cn.js";
import { TONE_VAR, type VizTone } from "./tones.js";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** A "nice" axis maximum and step (1, 2, 5 × 10^n) so gridlines land on round numbers. */
function niceScale(max: number, ticks = 4) {
  if (max <= 0) return { max: ticks, step: 1 };
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const stepInt = Math.max(1, step);
  return { max: Math.ceil(max / stepInt) * stepInt, step: stepInt };
}

function Dot({ tone }: { tone: VizTone }) {
  return <span aria-hidden className="inline-block size-2 shrink-0 rounded-full" style={{ background: TONE_VAR[tone], boxShadow: `0 0 10px ${TONE_VAR[tone]}` }} />;
}

export interface ChartSeries<K extends string> {
  key: K;
  label: string;
  tone: VizTone;
}

/**
 * Smooth multi-series area chart with a hover crosshair and tooltip.
 * Curves use horizontal-midpoint control points, so they never overshoot the data.
 */
export function AreaChart<K extends string, D extends { [P in K]: number }>({
  data,
  series,
  label,
  xLabel,
  height = 220,
}: {
  data: D[];
  series: ChartSeries<K>[];
  label: string;
  xLabel: (d: D, i: number) => string;
  height?: number;
}) {
  const uid = useId().replace(/:/g, "");
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  // Legend items toggle series; the axis rescales to what's visible (e.g. hide a series that dwarfs the rest).
  const [hidden, setHidden] = useState<Set<K>>(new Set());
  const shownSeries = series.filter((s) => !hidden.has(s.key));
  const toggle = (k: K) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else if (series.length - next.size > 1) next.add(k);
      return next;
    });
  const pad = { l: 34, r: 10, t: 12, b: 26 };
  const W = Math.max(width, 200);
  const H = height;
  const n = data.length;
  const { max, step } = niceScale(Math.max(0, ...data.flatMap((d) => shownSeries.map((s) => d[s.key]))));
  const x = (i: number) => pad.l + (n <= 1 ? 0 : (i * (W - pad.l - pad.r)) / (n - 1));
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const line = (k: K) =>
    data
      .map((d, i) => {
        if (i === 0) return `M${x(0)},${y(d[k])}`;
        const mx = (x(i - 1) + x(i)) / 2;
        return `C${mx},${y(data[i - 1]![k])} ${mx},${y(d[k])} ${x(i)},${y(d[k])}`;
      })
      .join(" ");
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - pad.l) / 64))));
  // Always label the last point; drop a regular label that would collide with it.
  const showLabel = (i: number) => i === n - 1 || (i % labelEvery === 0 && n - 1 - i >= Math.ceil(labelEvery * 0.75));

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, i)));
  };

  return (
    <div>
      <ul className="mb-3 flex flex-wrap gap-1.5 text-xs text-ink-2">
        {series.map((s) => {
          const off = hidden.has(s.key);
          return (
            <li key={s.key}>
              <button
                type="button"
                aria-pressed={!off}
                onClick={() => toggle(s.key)}
                title={off ? `Show ${s.label}` : `Hide ${s.label}`}
                className={cn(
                  "flex items-center gap-2 rounded-full border px-2.5 py-1 transition duration-200",
                  off ? "border-dashed border-line text-ink-3 opacity-60 hover:opacity-100" : "border-line bg-surface-2 hover:border-line-strong",
                )}
              >
                <Dot tone={s.tone} />
                {s.label}
                <span className="tabular font-semibold text-ink">{data.reduce((t, d) => t + d[s.key], 0)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div ref={wrapRef} className="relative" style={{ height: H }}>
        {width > 0 && (
          <svg
            width={W}
            height={H}
            role="img"
            aria-label={label}
            className="block touch-pan-y overflow-visible"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          >
            <defs>
              {series.map((s) => (
                <linearGradient key={s.key} id={`${uid}-${s.key}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={TONE_VAR[s.tone]} stopOpacity="0.32" />
                  <stop offset="100%" stopColor={TONE_VAR[s.tone]} stopOpacity="0" />
                </linearGradient>
              ))}
            </defs>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="rgb(255 255 255 / 0.06)" strokeDasharray={t === 0 ? undefined : "3 5"} />
                <text x={pad.l - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-ink-3 text-[10px] tabular">{t}</text>
              </g>
            ))}
            {data.map((d, i) =>
              showLabel(i) ? (
                <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} className="fill-ink-3 text-[10px]">
                  {xLabel(d, i)}
                </text>
              ) : null,
            )}
            {shownSeries.map((s, si) => (
              <g key={`${s.key}-${max}`}>
                <path
                  d={`${line(s.key)} L${x(n - 1)},${y(0)} L${x(0)},${y(0)} Z`}
                  fill={`url(#${uid}-${s.key})`}
                  className="animate-fade-in"
                  style={{ animationDelay: `${300 + si * 120}ms` }}
                />
                <path
                  d={line(s.key)}
                  fill="none"
                  stroke={TONE_VAR[s.tone]}
                  strokeWidth={2}
                  strokeLinecap="round"
                  pathLength={1}
                  strokeDasharray="1"
                  className="animate-draw"
                  style={{ animationDelay: `${si * 120}ms`, filter: `drop-shadow(0 0 6px ${TONE_VAR[s.tone]})` }}
                />
              </g>
            ))}
            {hover !== null && (
              <g pointerEvents="none">
                <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="rgb(255 255 255 / 0.18)" />
                {shownSeries.map((s) => (
                  <circle key={s.key} cx={x(hover)} cy={y(data[hover]![s.key])} r={4} fill="#0b0d16" stroke={TONE_VAR[s.tone]} strokeWidth={2} />
                ))}
              </g>
            )}
          </svg>
        )}
        {hover !== null && width > 0 && (
          <div
            className="pointer-events-none absolute top-0 z-10 min-w-36 rounded-xl border border-line-strong bg-[#0d0f1a]/95 px-3 py-2 text-xs shadow-pop backdrop-blur-md"
            style={{ left: Math.min(Math.max(x(hover), 80), W - 80), transform: "translateX(-50%)" }}
          >
            <p className="mb-1 font-medium text-ink">{xLabel(data[hover]!, hover)}</p>
            {shownSeries.map((s) => (
              <p key={s.key} className="flex items-center justify-between gap-4 text-ink-2">
                <span className="flex items-center gap-1.5"><Dot tone={s.tone} />{s.label}</span>
                <span className="tabular font-semibold text-ink">{data[hover]![s.key]}</span>
              </p>
            ))}
          </div>
        )}
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <thead><tr><th>Day</th>{series.map((s) => <th key={s.key}>{s.label}</th>)}</tr></thead>
        <tbody>{data.map((d, i) => <tr key={i}><td>{xLabel(d, i)}</td>{series.map((s) => <td key={s.key}>{d[s.key]}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export interface Segment {
  label: string;
  value: number;
  tone: VizTone;
}

/** Donut with a hover-able legend; the centre shows the total or the hovered segment. */
export function DonutChart({ segments, label, centerLabel, size = 168 }: { segments: Segment[]; label: string; centerLabel: string; size?: number }) {
  const [active, setActive] = useState<number | null>(null);
  const total = segments.reduce((t, s) => t + s.value, 0);
  const stroke = 16;
  const r = (size - stroke) / 2;
  const visible = segments.filter((s) => s.value > 0).length;
  const gap = visible > 1 ? 0.012 : 0;
  let start = 0;
  const arcs = segments.map((s) => {
    const frac = total ? s.value / total : 0;
    const arc = { ...s, start, frac };
    start += frac;
    return arc;
  });
  const shown = active !== null ? segments[active]! : null;
  const pct = (v: number) => (total ? Math.round((v / total) * 100) : 0);

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
      <div className="relative shrink-0 animate-fade-in" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label}: ${segments.map((s) => `${s.label} ${s.value}`).join(", ")}`} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(255 255 255 / 0.06)" strokeWidth={stroke} />
          {arcs.map((a, i) =>
            a.frac > 0 ? (
              <circle
                key={a.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={TONE_VAR[a.tone]}
                strokeWidth={active === i ? stroke + 4 : stroke}
                pathLength={1}
                strokeDasharray={`${Math.max(0.001, a.frac - gap)} 1`}
                strokeDashoffset={-a.start}
                className="cursor-pointer transition-all duration-300"
                style={{ opacity: active === null || active === i ? 1 : 0.3, filter: `drop-shadow(0 0 8px ${TONE_VAR[a.tone]})` }}
                onPointerEnter={() => setActive(i)}
                onPointerLeave={() => setActive(null)}
              />
            ) : null,
          )}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="tabular font-display text-3xl font-semibold tracking-tight text-ink">{shown ? shown.value : total}</p>
            <p className="text-[11px] text-ink-3">{shown ? `${shown.label} · ${pct(shown.value)}%` : centerLabel}</p>
          </div>
        </div>
      </div>
      <ul className="w-full min-w-0 flex-1 space-y-1">
        {segments.map((s, i) => (
          <li
            key={s.label}
            onPointerEnter={() => setActive(i)}
            onPointerLeave={() => setActive(null)}
            className={cn("flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors", active === i ? "bg-surface-2" : "")}
          >
            <Dot tone={s.tone} />
            <span className="flex-1 text-ink-2">{s.label}</span>
            <span className="tabular font-semibold text-ink">{s.value}</span>
            <span className="tabular w-10 text-right text-xs text-ink-3">{pct(s.value)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface BarItem {
  label: ReactNode;
  value: number;
  tone?: VizTone;
  key?: string;
}

/** Horizontal bars, largest first as given; bars grow in on mount. */
export function BarList({ items, label, format = String }: { items: BarItem[]; label: string; format?: (v: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-3.5" aria-label={label}>
      {items.map((item, idx) => {
        const tone = TONE_VAR[item.tone ?? "indigo"];
        return (
          <li key={item.key ?? String(idx)}>
            <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
              <span className="truncate text-ink-2">{item.label}</span>
              <span className="tabular font-semibold text-ink">{format(item.value)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full origin-left animate-grow-x rounded-full"
                style={{
                  width: `${Math.max(item.value > 0 ? 3 : 0, (item.value / max) * 100)}%`,
                  background: `linear-gradient(90deg, color-mix(in oklab, ${tone} 55%, transparent), ${tone})`,
                  boxShadow: `0 0 12px color-mix(in oklab, ${tone} 60%, transparent)`,
                  animationDelay: `${idx * 70}ms`,
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Compact inline meter (e.g. lead score 0–100). */
export function Meter({ value, max = 100, tone = "indigo", label }: { value: number; max?: number; tone?: VizTone; label: string }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <span role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} className="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-surface-3 align-middle">
      <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: TONE_VAR[tone], boxShadow: `0 0 8px ${TONE_VAR[tone]}` }} />
    </span>
  );
}
