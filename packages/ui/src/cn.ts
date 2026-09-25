import { extendTailwindMerge } from "tailwind-merge";

// Teach tailwind-merge our custom theme scales so e.g. `shadow-card` and `shadow-glow` override each other.
const merge = extendTailwindMerge({
  extend: {
    classGroups: {
      shadow: [{ shadow: ["card", "glow", "pop"] }],
      "font-family": [{ font: ["display", "sans", "mono"] }],
    },
  },
});

/** Joins class names; later classes win over earlier conflicting ones (`p-5` + `p-0` → `p-0`). */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return merge(parts.filter(Boolean).join(" "));
}
