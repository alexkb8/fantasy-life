// src/app/lib/timeframeTheme.ts
export type Timeframe = "weekly" | "monthly" | "yearly";

export function tfLabel(tf: Timeframe) {
  if (tf === "weekly") return "Weekly";
  if (tf === "monthly") return "Monthly";
  return "Yearly";
}

/**
 * Shared Tailwind tokens for each timeframe.
 * Yearly is intentionally "special" (gold/amber).
 */
export const TF_THEME: Record<
  Timeframe,
  {
    panel: string;
    badge: string;
    dot: string;
    hoverCard: string; // stable hover, no ring flicker
    button: string;
    accentText: string;
  }
> = {
  weekly: {
    panel: "border-sky-200 bg-sky-50/60",
    badge: "border-sky-200 bg-sky-50 text-sky-900",
    dot: "bg-sky-600",
    hoverCard: "hover:border-sky-300 hover:bg-sky-50/50 hover:shadow-sm",
    button: "border-sky-200 bg-sky-50 text-sky-900 hover:bg-sky-100",
    accentText: "text-sky-700",
  },
  monthly: {
    panel: "border-indigo-200 bg-indigo-50/60",
    badge: "border-indigo-200 bg-indigo-50 text-indigo-900",
    dot: "bg-indigo-600",
    hoverCard: "hover:border-indigo-300 hover:bg-indigo-50/50 hover:shadow-sm",
    button: "border-indigo-200 bg-indigo-50 text-indigo-900 hover:bg-indigo-100",
    accentText: "text-indigo-700",
  },
  yearly: {
    // ⭐ Special long-term vibe: gold/amber
    panel: "border-amber-200 bg-gradient-to-b from-amber-50/90 to-yellow-50/60",
    badge: "border-amber-200 bg-amber-50 text-amber-950",
    dot: "bg-amber-500",
    hoverCard: "hover:border-amber-300 hover:bg-amber-50/60 hover:shadow-sm",
    button: "border-amber-200 bg-amber-50 text-amber-950 hover:bg-amber-100",
    accentText: "text-amber-800",
  },
};

export function tfTheme(tf: Timeframe) {
  return TF_THEME[tf];
}