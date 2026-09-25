import { useId, type InputHTMLAttributes } from "react";
import { cn } from "./cn.js";

export function Field({ label, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const id = useId();
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm text-ink-2">{label}</label>
      <input
        id={id}
        className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
        {...props}
      />
    </div>
  );
}
