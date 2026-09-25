import { useId, type ReactNode, type SelectHTMLAttributes } from "react";
import { fieldClass } from "@acc/ui";

export function Select({ label, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-ink-2">{label}</label>
      <select id={id} className={fieldClass} {...props}>{children}</select>
    </div>
  );
}

/** Reads a form, dropping empty strings. Rupee fields ending in "Pkr" become minor units (×100). */
export function formValues(form: HTMLFormElement): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of new FormData(form).entries()) {
    const s = String(v).trim();
    if (s === "") continue;
    if (k.endsWith("Pkr")) out[k.replace(/Pkr$/, "Minor")] = Math.round(Number(s) * 100);
    else if (/^(capacity|durationWeeks|durationMin|maxScore)$/.test(k)) out[k] = Number(s);
    else out[k] = s;
  }
  return out;
}

/** "2026-10-01T20:00" (Pakistan time from a datetime-local input) → ISO with +05:00. */
export const pktToIso = (v: string) => `${v}:00+05:00`;
