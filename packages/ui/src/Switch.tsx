import { cn } from "./cn.js";

/** Accessible on/off switch (role="switch"). The label is required for screen readers. */
export function Switch({ checked, onChange, label, disabled, className }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; className?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition duration-200 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "border-accent/50 bg-linear-to-r from-brand-1 to-brand-2 shadow-[0_0_16px_-2px_rgb(124_58_237/0.7)]" : "border-line-strong bg-surface-3",
        className,
      )}
    >
      <span className={cn("inline-block size-4.5 rounded-full bg-white shadow transition duration-200", checked ? "translate-x-[22px]" : "translate-x-[3px]")} />
    </button>
  );
}
