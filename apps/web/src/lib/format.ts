const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat("en-US");

/** 1,284 / 12.9K / 4.2M */
export function formatCount(n: number): string {
  return Math.abs(n) < 10_000 ? whole.format(n) : compact.format(n);
}

/** Minor units → "PKR 12,500" (compact above 1M). */
export function formatMoney(minor: number, currency = "PKR"): string {
  const major = minor / 100;
  const value = Math.abs(major) >= 1_000_000 ? compact.format(major) : whole.format(Math.round(major));
  return `${currency} ${value}`;
}

export function formatDateTime(iso: string, tz = "Asia/Karachi"): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: tz }).format(new Date(iso));
}

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
