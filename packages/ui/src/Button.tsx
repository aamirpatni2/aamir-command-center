import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn.js";

type Variant = "primary" | "secondary" | "ghost" | "danger";
const VARIANT: Record<Variant, string> = {
  // White text on #5f58f0 → #4338ca stays above WCAG AA contrast.
  primary:
    "bg-linear-to-b from-brand-1 to-accent-strong text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.22),0_8px_24px_-10px_rgb(99_102_241/0.9)] hover:brightness-110 hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_10px_30px_-8px_rgb(99_102_241/0.95)]",
  secondary: "border border-line bg-surface-2 text-ink hover:border-line-strong hover:bg-surface-3",
  ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
  danger: "bg-linear-to-b from-red-600 to-red-700 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_8px_24px_-10px_rgb(220_38_38/0.8)] hover:brightness-110",
};

export function Button({ variant = "primary", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition duration-200 ease-out select-none",
        "active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        "disabled:pointer-events-none disabled:opacity-45",
        VARIANT[variant],
        className,
      )}
      {...props}
    />
  );
}
