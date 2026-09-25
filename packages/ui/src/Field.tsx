import { useId, type InputHTMLAttributes } from "react";
import { cn } from "./cn.js";

/** Shared look for text inputs, selects and textareas (recessed field with a soft accent focus glow). */
export const fieldClass =
  "w-full rounded-xl border border-line bg-bg px-3.5 py-2.5 text-sm text-ink shadow-[inset_0_1px_2px_rgb(0_0_0/0.35)] transition duration-200 placeholder:text-ink-3 hover:border-line-strong focus:border-accent/70 focus:outline-none focus:ring-4 focus:ring-accent/15";

export function Field({ label, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const id = useId();
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-medium text-ink-2">{label}</label>
      <input id={id} className={fieldClass} {...props} />
    </div>
  );
}
