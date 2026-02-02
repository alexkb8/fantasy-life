"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import Avatar from "../components/Avatar";
import type { Timeframe } from "../../lib/timeframeTheme";
import { tfLabel } from "../../lib/timeframeTheme";
import {
  TimeframePill,
  TimeframeDot,
  timeframePanelClass,
  timeframeAccentTextClass,
} from "../components/TimeframeUI";

type TaskRow = {
  user_id: string;
  timeframe: Timeframe;
  slot_index: number;
  title: string;
  done_at: string | null;
};

type ProfileRow = {
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

type CompletionRow = {
  id: number;
  user_id: string;
  timeframe: string;
  slot_index: number;
  title: string | null;
  completed_at: string;
};

type UserId = "alex" | "bob" | "jeff" | "sean";
const ACTIVE_USER_KEY = "fantasy-life:activeUser";

function getActiveUser(): UserId {
  if (typeof window === "undefined") return "alex";
  const raw = localStorage.getItem(ACTIVE_USER_KEY);
  if (raw === "alex" || raw === "bob" || raw === "jeff" || raw === "sean") return raw;
  return "alex";
}

const SLOT_COUNTS: Record<Timeframe, number> = { weekly: 3, monthly: 2, yearly: 2 };
const POINTS: Record<Timeframe, number> = { weekly: 1, monthly: 4, yearly: 40 };

function slotKey(tf: Timeframe, i: number) {
  return `${tf}:${i}`;
}

/** ---- Time helpers (ISO week + grouping) ---- */
function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function isoWeekStart(d: Date) {
  const date = startOfDay(d);
  const day = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - day);
  return date;
}
function isoWeekNumber(d: Date) {
  const date = startOfDay(d);
  const day = ((date.getDay() + 6) % 7) + 1;
  date.setDate(date.getDate() + (4 - day));
  const yearStart = new Date(date.getFullYear(), 0, 1);
  const diffDays = Math.floor((date.getTime() - yearStart.getTime()) / 86400000);
  return Math.floor(diffDays / 7) + 1;
}
function daysLeftInclusive(endDate: Date) {
  const today = startOfDay(new Date()).getTime();
  const end = startOfDay(endDate).getTime();
  const diff = Math.ceil((end - today) / 86400000);
  return diff < 0 ? 0 : diff;
}
function fmtShort(d: Date) {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function fmtLong(d: Date) {
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

/** Perfect-count helpers (YTD completion-rate meter) */
function weeksElapsedYTD(now = new Date()) {
  return isoWeekNumber(now);
}
function monthsElapsedYTD(now = new Date()) {
  return now.getMonth() + 1;
}
function perfectCountYTD(tf: Timeframe, now = new Date()) {
  if (tf === "weekly") return weeksElapsedYTD(now);
  if (tf === "monthly") return monthsElapsedYTD(now);
  return 1;
}

type YtdCounts = { weekly: number; monthly: number; yearly: number; total: number };

type SlotStat = {
  timeframe: Timeframe;
  slot_index: number;
  taskTitle: string;

  completions: number;
  perfect: number;
  completionRate: number;

  points: number;
};

function clampPct(x: number) {
  if (isNaN(x) || !isFinite(x)) return 0;
  return Math.max(0, Math.min(100, Math.round(x)));
}

export default function TasksPage() {
  const [activeUser, setActiveUser] = useState<UserId>("alex");

  const [tasks, setTasks] = useState<Record<string, TaskRow>>({});
  const [draftTitles, setDraftTitles] = useState<Record<string, string>>({});

  const [nameByHandle, setNameByHandle] = useState<Record<string, string>>({});
  const [avatarByHandle, setAvatarByHandle] = useState<Record<string, string>>({});

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string>("");

  const [ytd, setYtd] = useState<YtdCounts>({ weekly: 0, monthly: 0, yearly: 0, total: 0 });
  const [history, setHistory] = useState<CompletionRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [slotStats, setSlotStats] = useState<SlotStat[]>([]);

  const loadingRef = useRef(false);

  useEffect(() => {
    setActiveUser(getActiveUser());
    const onChange = () => setActiveUser(getActiveUser());
    window.addEventListener("fantasy-life:activeUserChanged", onChange);
    return () => window.removeEventListener("fantasy-life:activeUserChanged", onChange);
  }, []);

  const displayName = useMemo(() => {
    const fallback = activeUser.charAt(0).toUpperCase() + activeUser.slice(1);
    return nameByHandle[activeUser] ?? fallback;
  }, [activeUser, nameByHandle]);

  const seasonClock = useMemo(() => {
    const now = new Date();
    const wkNum = isoWeekNumber(now);
    const wkStart = isoWeekStart(now);
    const wkEnd = addDays(wkStart, 6);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    return {
      today: fmtLong(now),
      weekLabel: `Week ${wkNum}`,
      weekRange: `${fmtShort(wkStart)} – ${fmtShort(wkEnd)}`,
      weekEndsIn: daysLeftInclusive(wkEnd),
      monthLabel: now.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
      monthEndsIn: daysLeftInclusive(monthEnd),
    };
  }, []);

  const startOfYearISO = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), 0, 1).toISOString();
  }, []);

  const statsBySlot = useMemo(() => {
    const m = new Map<string, SlotStat>();
    for (const s of slotStats) m.set(`${s.timeframe}:${s.slot_index}`, s);
    return m;
  }, [slotStats]);

  const loadYTDHistoryAndStats = async (userHandle: string, taskMap: Record<string, TaskRow>) => {
    setHistoryLoading(true);

    const res = await supabase
      .from("task_completions")
      .select("id,user_id,timeframe,slot_index,title,completed_at")
      .eq("user_id", userHandle)
      .gte("completed_at", startOfYearISO)
      .order("completed_at", { ascending: false })
      .limit(500);

    if (res.error) {
      setHistoryLoading(false);
      return;
    }

    const rows = (res.data ?? []) as CompletionRow[];
    setHistory(rows);

    const counts: YtdCounts = { weekly: 0, monthly: 0, yearly: 0, total: 0 };
    const countMap = new Map<string, number>(); // tf|slot -> completions

    for (const r of rows) {
      const tf = r.timeframe as Timeframe;
      if (tf === "weekly" || tf === "monthly" || tf === "yearly") {
        counts[tf] += 1;
        counts.total += 1;
        const k = `${tf}|${r.slot_index}`;
        countMap.set(k, (countMap.get(k) ?? 0) + 1);
      }
    }
    setYtd(counts);

    const now = new Date();
    const stats: SlotStat[] = [];
    (["weekly", "monthly", "yearly"] as Timeframe[]).forEach((tf) => {
      for (let i = 0; i < SLOT_COUNTS[tf]; i++) {
        const k = `${tf}|${i}`;
        const completions = countMap.get(k) ?? 0;
        const perfect = perfectCountYTD(tf, now);
        const completionRate = perfect > 0 ? completions / perfect : 0;
        const points = completions * POINTS[tf];

        const title = taskMap[slotKey(tf, i)]?.title ?? tfLabel(tf);

        stats.push({
          timeframe: tf,
          slot_index: i,
          taskTitle: title,
          completions,
          perfect,
          completionRate,
          points,
        });
      }
    });

    setSlotStats(stats);
    setHistoryLoading(false);
  };

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (loadingRef.current) return;
      loadingRef.current = true;

      setLoading(true);
      setMsg("");

      const profRes = await supabase.from("profiles").select("handle, display_name, avatar_url");
      if (!profRes.error) {
        const nb: Record<string, string> = {};
        const ab: Record<string, string> = {};
        for (const r of (profRes.data ?? []) as ProfileRow[]) {
          if (!r.handle) continue;
          nb[r.handle] = r.display_name || r.handle;
          if (r.avatar_url) ab[r.handle] = r.avatar_url;
        }
        if (!cancelled) {
          setNameByHandle(nb);
          setAvatarByHandle(ab);
        }
      }

      const tRes = await supabase
        .from("tasks")
        .select("user_id,timeframe,slot_index,title,done_at")
        .eq("user_id", activeUser);

      if (tRes.error) {
        if (!cancelled) {
          setMsg(tRes.error.message);
          setLoading(false);
        }
        loadingRef.current = false;
        return;
      }

      const map: Record<string, TaskRow> = {};
      for (const t of (tRes.data ?? []) as TaskRow[]) {
        map[slotKey(t.timeframe, t.slot_index)] = t;
      }

      (["weekly", "monthly", "yearly"] as Timeframe[]).forEach((tf) => {
        for (let i = 0; i < SLOT_COUNTS[tf]; i++) {
          const k = slotKey(tf, i);
          if (!map[k]) {
            map[k] = {
              user_id: activeUser,
              timeframe: tf,
              slot_index: i,
              title:
                tf === "weekly" ? `Weekly goal ${i + 1}` : tf === "monthly" ? `Monthly goal ${i + 1}` : `Yearly goal ${i + 1}`,
              done_at: null,
            };
          }
        }
      });

      if (cancelled) {
        loadingRef.current = false;
        return;
      }

      setTasks(map);

      const dt: Record<string, string> = {};
      for (const tf of ["weekly", "monthly", "yearly"] as Timeframe[]) {
        for (let i = 0; i < SLOT_COUNTS[tf]; i++) {
          const k = slotKey(tf, i);
          dt[k] = map[k]?.title ?? "";
        }
      }
      setDraftTitles(dt);

      await loadYTDHistoryAndStats(activeUser, map);

      if (!cancelled) setLoading(false);
      loadingRef.current = false;
    };

    load();

    return () => {
      cancelled = true;
      loadingRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeUser, startOfYearISO]);

  const saveTitleOnBlur = async (tf: Timeframe, i: number) => {
    const k = slotKey(tf, i);
    const cur = tasks[k];
    const title = (draftTitles[k] ?? "").trim();
    if (!cur) return;
    if (title.length === 0) return;
    if (title === cur.title) return;

    const next: TaskRow = { ...cur, title };
    setTasks((prev) => ({ ...prev, [k]: next }));

    const { error } = await supabase
      .from("tasks")
      .upsert(
        { user_id: activeUser, timeframe: tf, slot_index: i, title: next.title, done_at: next.done_at },
        { onConflict: "user_id,timeframe,slot_index" }
      );

    if (error) setMsg(error.message);

    await loadYTDHistoryAndStats(activeUser, { ...tasks, [k]: next });
  };

  const toggleDone = async (tf: Timeframe, i: number) => {
    const k = slotKey(tf, i);
    const cur = tasks[k];
    if (!cur) return;

    const markingDone = !cur.done_at;
    const newDoneAt = markingDone ? new Date().toISOString() : null;

    const next: TaskRow = { ...cur, done_at: newDoneAt };
    setTasks((prev) => ({ ...prev, [k]: next }));

    const { error } = await supabase
      .from("tasks")
      .upsert(
        { user_id: activeUser, timeframe: tf, slot_index: i, title: next.title, done_at: next.done_at },
        { onConflict: "user_id,timeframe,slot_index" }
      );

    if (error) {
      setTasks((prev) => ({ ...prev, [k]: cur }));
      setMsg(error.message);
      return;
    }

    if (markingDone) {
      const ins = await supabase.from("task_completions").insert({
        user_id: activeUser,
        timeframe: tf,
        slot_index: i,
        title: next.title,
        completed_at: newDoneAt,
      });
      if (ins.error) setMsg(ins.error.message);
    }

    await loadYTDHistoryAndStats(activeUser, { ...tasks, [k]: next });
  };

  function RatingMeter({ tf, pct }: { tf: Timeframe; pct: number }) {
    const h = clampPct(pct);
    const barColor = tf === "weekly" ? "bg-sky-500" : tf === "monthly" ? "bg-indigo-500" : "bg-amber-500";
    return (
      <div className="flex items-center gap-2">
        <div className="relative h-10 w-3 overflow-hidden rounded-full border border-slate-200 bg-white">
          <div className={"absolute bottom-0 left-0 right-0 " + barColor} style={{ height: `${h}%` }} />
        </div>
        <div className="text-xs font-black text-slate-900">{h}%</div>
      </div>
    );
  }

  const CheckCard = ({ tf, i }: { tf: Timeframe; i: number }) => {
    const k = slotKey(tf, i);
    const t = tasks[k];
    const done = !!t?.done_at;

    const s = statsBySlot.get(`${tf}:${i}`) ?? null;
    const pct = s ? s.completionRate * 100 : 0;

    // bigger + centered "player icon" for *My Tasks*
    const myAvatar = avatarByHandle[activeUser] ?? null;

    return (
      <div className={["rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-sm transition", done ? "ring-1 ring-emerald-200" : "hover:bg-slate-50"].join(" ")}>
        <div className="flex items-center justify-between gap-2">
          <TimeframePill tf={tf} />

          <button
            type="button"
            onClick={() => toggleDone(tf, i)}
            className={[
              "flex h-10 w-10 items-center justify-center rounded-xl border text-lg font-black transition",
              done ? "border-emerald-300 bg-emerald-600 text-white" : "border-slate-300 bg-white text-slate-300 hover:border-slate-400",
            ].join(" ")}
            title="Mark done"
          >
            {done ? "✓" : ""}
          </button>
        </div>

        {/* Avatar + rating only (no extra text) */}
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Avatar src={myAvatar} alt={displayName} size={56} />
            <div className="min-w-0">
              <div className="text-sm font-black text-slate-900">{displayName}</div>
            </div>
          </div>

          <RatingMeter tf={tf} pct={pct} />
        </div>

        <input
          value={draftTitles[k] ?? ""}
          onChange={(e) => setDraftTitles((prev) => ({ ...prev, [k]: e.target.value }))}
          onBlur={() => saveTitleOnBlur(tf, i)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
          }}
          className={[
            "mt-3 w-full rounded-xl border px-3 py-2 text-sm font-semibold outline-none",
            done ? "border-emerald-200 bg-white/60 text-slate-700" : "border-slate-200 bg-white text-slate-900",
          ].join(" ")}
          placeholder="Set your goal…"
        />
      </div>
    );
  };

  const historyByWeek = useMemo(() => {
    const groups: Record<string, CompletionRow[]> = {};
    for (const r of history) {
      const d = new Date(r.completed_at);
      const wkStart = isoWeekStart(d);
      const key = wkStart.toISOString().slice(0, 10);
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    }
    const keys = Object.keys(groups).sort((a, b) => (a < b ? 1 : -1));
    return { groups, keys };
  }, [history]);

  const MyStatsPanel = () => (
    <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200">
      <div className="bg-slate-50 px-4 py-3">
        <div className="text-sm font-bold text-slate-900">My slot stats</div>
        <div className="text-xs text-slate-600">Points = total earned YTD.</div>
      </div>

      <table className="w-full text-left text-sm">
        <thead className="bg-white text-xs font-bold uppercase text-slate-600">
          <tr className="border-t border-slate-200">
            <th className="px-4 py-3">Type</th>
            <th className="px-4 py-3">Goal</th>
            <th className="px-4 py-3">Points</th>
            <th className="px-4 py-3">Rate</th>
          </tr>
        </thead>

        <tbody className="divide-y divide-slate-200 bg-white">
          {slotStats.map((s) => {
            const pct = clampPct(s.completionRate * 100);
            const barColor = s.timeframe === "weekly" ? "bg-sky-500" : s.timeframe === "monthly" ? "bg-indigo-500" : "bg-amber-500";
            return (
              <tr key={`${s.timeframe}-${s.slot_index}`}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <TimeframeDot tf={s.timeframe} />
                    <div className="font-semibold text-slate-900">{tfLabel(s.timeframe)}</div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="font-semibold text-slate-900">{s.taskTitle}</div>
                </td>
                <td className="px-4 py-3">
                  <div className={"font-black " + timeframeAccentTextClass(s.timeframe)}>{s.points}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="text-sm font-bold text-slate-900">{pct}%</div>
                    <div className="h-2 w-36 overflow-hidden rounded-full border border-slate-200 bg-slate-50">
                      <div className={"h-full " + barColor} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                </td>
              </tr>
            );
          })}

          {slotStats.length === 0 && (
            <tr>
              <td className="px-4 py-4 text-slate-600" colSpan={4}>
                No stats yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  const YtdAndHistory = () => (
    <div className="mt-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-lg font-bold text-slate-900">Year-to-date</div>
          <div className="text-xs text-slate-600">Since Jan 1.</div>
        </div>
        <div className="text-sm font-bold text-slate-900">
          Total logged: <span className="text-slate-700">{ytd.total}</span>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <div className={"rounded-2xl border p-4 " + timeframePanelClass("weekly")}>
          <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
            <TimeframeDot tf="weekly" />
            Weekly
          </div>
          <div className={"mt-1 text-3xl font-black " + timeframeAccentTextClass("weekly")}>{ytd.weekly}</div>
        </div>

        <div className={"rounded-2xl border p-4 " + timeframePanelClass("monthly")}>
          <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
            <TimeframeDot tf="monthly" />
            Monthly
          </div>
          <div className={"mt-1 text-3xl font-black " + timeframeAccentTextClass("monthly")}>{ytd.monthly}</div>
        </div>

        <div className={"rounded-2xl border p-4 " + timeframePanelClass("yearly")}>
          <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
            <TimeframeDot tf="yearly" />
            Yearly
          </div>
          <div className={"mt-1 text-3xl font-black " + timeframeAccentTextClass("yearly")}>{ytd.yearly}</div>
        </div>
      </div>

      <MyStatsPanel />

      <div className="mt-8">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-bold text-slate-900">History (by week)</div>
          <div className="text-xs text-slate-500">{historyLoading ? "Loading…" : `Showing up to ${history.length}`}</div>
        </div>

        <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs font-bold uppercase text-slate-600">
              <tr>
                <th className="px-4 py-3">Week</th>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Goal</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Pts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {historyByWeek.keys.length === 0 ? (
                <tr>
                  <td className="px-4 py-4 text-slate-600" colSpan={5}>
                    No completions logged yet this year.
                  </td>
                </tr>
              ) : (
                historyByWeek.keys.flatMap((wkKey) => {
                  const wkStart = new Date(wkKey);
                  const wkEnd = addDays(wkStart, 6);
                  const wkNum = isoWeekNumber(wkStart);

                  return historyByWeek.groups[wkKey]
                    .sort((a, b) => (a.completed_at < b.completed_at ? 1 : -1))
                    .map((r, idx) => {
                      const tf = r.timeframe as Timeframe;
                      const pts = tf === "weekly" || tf === "monthly" || tf === "yearly" ? POINTS[tf] : 0;

                      return (
                        <tr key={`${wkKey}-${r.id}`}>
                          <td className="px-4 py-3 text-slate-700">
                            {idx === 0 ? (
                              <div className="font-semibold">
                                W{wkNum} <span className="text-slate-500">({fmtShort(wkStart)}–{fmtShort(wkEnd)})</span>
                              </div>
                            ) : (
                              ""
                            )}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {new Date(r.completed_at).toLocaleString(undefined, {
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </td>
                          <td className="px-4 py-3 font-semibold text-slate-900">{r.title ?? `(slot ${r.slot_index + 1})`}</td>
                          <td className="px-4 py-3">
                            <TimeframePill tf={tf} />
                          </td>
                          <td className={"px-4 py-3 font-bold " + timeframeAccentTextClass(tf)}>+{pts}</td>
                        </tr>
                      );
                    });
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-5xl px-5 py-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">My Tasks</h1>
            <p className="mt-1 text-sm text-slate-600">Check off your goals.</p>
          </div>

          <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <Avatar src={avatarByHandle[activeUser]} alt={displayName} size={56} />
            <div className="text-right">
              <div className="text-xs font-semibold text-slate-600">Player</div>
              <div className="text-sm font-bold text-slate-900">{displayName}</div>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-semibold text-slate-900">Today: {seasonClock.today}</div>
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center rounded-xl border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-bold text-sky-800">
                {seasonClock.weekLabel} · ends in {seasonClock.weekEndsIn}d
              </span>
              <span className="inline-flex items-center rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-800">
                {seasonClock.monthLabel} · ends in {seasonClock.monthEndsIn}d
              </span>
            </div>
          </div>
        </div>

        {msg && (
          <div className="mt-4 rounded-2xl border border-red-200 bg-white p-4 text-sm text-red-700">{msg}</div>
        )}

        {/* Formation: ONLY the soccer field */}
        <div className="mt-6">
          <div className="relative mx-auto max-w-3xl overflow-hidden rounded-3xl border border-emerald-200 bg-emerald-100/40 p-5 shadow-sm">
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute left-0 right-0 top-1/2 h-[2px] bg-emerald-200/70" />
              <div className="absolute left-1/2 top-1/2 h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-emerald-200/70" />
            </div>

            {loading ? (
              <div className="relative text-sm text-slate-600">Loading…</div>
            ) : (
              <div className="relative grid gap-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <CheckCard tf="weekly" i={0} />
                  <CheckCard tf="weekly" i={1} />
                  <CheckCard tf="weekly" i={2} />
                </div>

                <div className="mx-auto grid w-full max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
                  <CheckCard tf="monthly" i={0} />
                  <CheckCard tf="monthly" i={1} />
                </div>

                <div className="mx-auto grid w-full max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
                  <CheckCard tf="yearly" i={0} />
                  <CheckCard tf="yearly" i={1} />
                </div>
              </div>
            )}
          </div>
        </div>

        <YtdAndHistory />
      </div>
    </main>
  );
}