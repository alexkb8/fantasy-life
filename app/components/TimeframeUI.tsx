// src/app/components/TimeframeUI.tsx
"use client";

import type { Timeframe } from "../../lib/timeframeTheme";
import { tfLabel, tfTheme } from "../../lib/timeframeTheme";

export function TimeframePill({ tf, className = "" }: { tf: Timeframe; className?: string }) {
  const th = tfTheme(tf);
  return (
    <span
      className={
        "inline-flex items-center gap-2 rounded-xl border px-3 py-1 text-xs font-black " +
        th.badge +
        " " +
        className
      }
      title={tfLabel(tf)}
    >
      <span className={"h-2.5 w-2.5 rounded-full " + th.dot} />
      {tfLabel(tf)}
    </span>
  );
}

export function TimeframeDot({ tf, className = "" }: { tf: Timeframe; className?: string }) {
  const th = tfTheme(tf);
  return <span className={"inline-block h-2.5 w-2.5 rounded-full " + th.dot + " " + className} />;
}

export function timeframePanelClass(tf: Timeframe) {
  return tfTheme(tf).panel;
}

export function timeframeCardClass(tf: Timeframe) {
  // stable hover (no rings)
  return "border-slate-200 bg-white " + tfTheme(tf).hoverCard;
}

export function timeframeButtonClass(tf: Timeframe) {
  return tfTheme(tf).button;
}

export function timeframeAccentTextClass(tf: Timeframe) {
  return tfTheme(tf).accentText;
}