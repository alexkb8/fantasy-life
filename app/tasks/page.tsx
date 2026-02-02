"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import Avatar from "../components/Avatar";

type Timeframe = "weekly" | "monthly" | "yearly";
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

const USERS: { id: UserId; name: string }[] = [
  { id: "alex", name: "Alex" },
  { id: "bob", name: "Bob" },
  { id: "jeff", name: "Jeff" },
  { id: "sean", name: "Sean" },
];

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
function slotLabel(tf: Timeframe, i: number) {
  const base = tf === "weekly" ? "Weekly" : tf === "monthly" ? "Monthly" : "Yearly";
  return `${base} ${i + 1}`;
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
  const day = (date.getDay() + 6) % 7; // Mon=0..Sun=6
  date.setDate(date.getDate() - day);
  return date;
}
function isoWeekNumber(d: Date) {
  const date = startOfDay(d);
  const day = ((date.getDay() + 6) % 7) + 1; // Mon=1..Sun=7
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

/** Perfect-count helpers (used only for rate calc; not displayed) */
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
  label: string;
  taskTitle: string;

  completions: number;
  perfect: number;
  completionRate: number;

  points: number;
};

export default function TasksPage() {
  const [activeUser, setActiveUser] = useState<UserId>("alex");
  const [tasks, setTasks] = useState<Record<string, TaskRow>>({});
  const [nameByHandle, setNameByHandle] = useState<Record<string, string>>({});
  const [avatarByHandle, setAvatarByHandle] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string>("");

  const [ytd, setYtd] = useState<YtdCounts>({ weekly: 0, monthly: 0, yearly: 0, total: 0 });
  const [history, setHistory] = useState<CompletionRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [slotStats, setSlotStats] = useState<SlotStat[]>([]);

  useEffect(() => {
    setActiveUser(getActiveUser());
    const onChange = () => setActiveUser(getActiveUser());
    window.addEventListener("fantasy-life:activeUserChanged", onChange);
    return () => window.removeEventListener("fantasy-life:activeUserChanged", onChange);
  }, []);

  const displayName = useMemo(() => {
    return nameByHandle[activeUser] ?? USERS.find((u) => u.id === activeUser)?.name ?? activeUser;
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

  const loadYTDHistoryAndStats = async (userHandle: string, taskMap: Record<string, TaskRow>) => {
    setHistoryLoading(true);

    const res = await supabase
      .from("task_completions")
      .select("id,user_id,timeframe,slot_index,title,completed_at")
      .eq("user_id", userHandle)
      .gte("completed_at", startOfYearISO)
      .order("completed_at", { ascending: false })
      .limit(400);

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

        const title = taskMap[slotKey(tf, i)]?.title ?? slotLabel(tf, i);

        stats.push({
          timeframe: tf,
          slot_index: i,
          label: slotLabel(tf, i),
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
    const load = async () => {
      setLoading(true);
      setMsg("");

      // profiles
      const profRes = await supabase.from("profiles").select("handle, display_name, avatar_url");
      if (!profRes.error) {
        const nb: Record<string, string> = {};
        const ab: Record<string, string> = {};
        for (const r of (profRes.data ?? []) as ProfileRow[]) {
          if (!r.handle) continue;
          nb[r.handle] = r.display_name || r.handle;
          if (r.avatar_url) ab[r.handle] = r.avatar_url;
        }
        setNameByHandle(nb);
        setAvatarByHandle(ab);
      }

      // tasks
      const tRes = await supabase
        .from("tasks")
        .select("user_id,timeframe,slot_index,title,done_at")
        .eq("user_id", activeUser);

      if (tRes.error) {
        setMsg(tRes.error.message);
        setLoading(false);
        return;
      }

      const map: Record<string, TaskRow> = {};
      for (const t of (tRes.data ?? []) as TaskRow[]) {
        map[slotKey(t.timeframe, t.slot_index)] = t;
      }

      // ensure slots exist locally
      (["weekly", "monthly", "yearly"] as Timeframe[]).forEach((tf) => {
        for (let i = 0; i < SLOT_COUNTS[tf]; i++) {
          const k = slotKey(tf, i);
          if (!map[k]) {
            map[k] = {
              user_id: activeUser,
              timeframe: tf,
              slot_index: i,
              title:
                tf === "weekly"
                  ? `Weekly goal ${i + 1}`
                  : tf === "monthly"
                  ? `Monthly goal ${i + 1}`
                  : `Yearly goal ${i + 1}`,
              done_at: null,
            };
          }
        }
      });

      setTasks(map);

      await loadYTDHistoryAndStats(activeUser, map);

      setLoading(false);
    };

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeUser, startOfYearISO]);

  const saveTaskTitle = async (tf: Timeframe, i: number, title: string) => {
    const k = slotKey(tf, i);
    const cur = tasks[k];
    const next: TaskRow = { ...cur, title };
    setTasks((prev) => ({ ...prev, [k]: next }));

    const { error } = await supabase
      .from("tasks")
      .upsert(
        { user_id: activeUser, timeframe: tf, slot_index: i, title, done_at: cur?.done_at ?? null },
        { onConflict: "user_id,timeframe,slot_index" }
      );

    if (error) setMsg(error.message);
  };

  const toggleDone = async (tf: Timeframe, i: number) => {
    const k = slotKey(tf, i);
    const cur = tasks[k];
    const markingDone = !cur.done_at;
    const newDoneAt = markingDone ? new Date().toISOString() : null;

    setTasks((prev) => ({ ...prev, [k]: { ...cur, done_at: newDoneAt } }));

    const { error } = await supabase
      .from("tasks")
      .upsert(
        { user_id: activeUser, timeframe: tf, slot_index: i, title: cur.title, done_at: newDoneAt },
        { onConflict: "user_id,timeframe,slot_index" }
      );

    if (error) {
      setTasks((prev) => ({ ...prev, [k]: cur }));
      setMsg(error.message);
      return;
    }

    // log completion only when marking done
    if (markingDone) {
      const ins = await supabase.from("task_completions").insert({
        user_id: activeUser,
        timeframe: tf,
        slot_index: i,
        title: cur.title,
        completed_at: newDoneAt,
      });

      if (ins.error) setMsg(ins.error.message);

      // refresh stats/history
      await loadYTDHistoryAndStats(activeUser, { ...tasks, [k]: { ...cur, done_at: newDoneAt } });
    }
  };

  const CheckCard = ({ tf, i, label }: { tf: Timeframe; i: number; label: string }) => {
    const t = tasks[slotKey(tf, i)];
    const done = !!t?.done_at;

    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => toggleDone(tf, i)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") toggleDone(tf, i);
        }}
        className={[
          "cursor-pointer select-none rounded-2xl border p-3 shadow-sm transition",
          done ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200 bg-white/90 hover:bg-slate-50",
        ].join(" ")}
        title="Click to toggle complete"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-600">{label}</div>

          <div
            className={[
              "flex h-9 w-9 items-center justify-center rounded-xl border text-lg font-black transition",
              done ? "border-emerald-300 bg-emerald-600 text-white" : "border-slate-300 bg-white text-slate-300",
            ].join(" ")}
          >
            {done ? "✓" : ""}
          </div>
        </div>

        <input
          value={t?.title ?? ""}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onChange={(e) => saveTaskTitle(tf, i, e.target.value)}
          className={[
            "mt-2 w-full rounded-xl border px-3 py-2 text-sm font-semibold outline-none",
            done ? "border-emerald-200 bg-white/60 text-slate-700" : "border-slate-200 bg-white text-slate-900",
          ].join(" ")}
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
        <div className="text-sm font-bold text-slate-900">My stat lines</div>
        <div className="text-xs text-slate-600">Points are total points earned YTD for that slot. Rate is based on time elapsed this year.</div>
      </div>

      <table className="w-full text-left text-sm">
        <thead className="bg-white text-xs font-bold uppercase text-slate-600">
          <tr className="border-t border-slate-200">
            <th className="px-4 py-3">Slot</th>
            <th className="px-4 py-3">Goal</th>
            <th className="px-4 py-3">Points</th>
            <th className="px-4 py-3">Rate</th>
          </tr>
        </thead>

        <tbody className="divide-y divide-slate-200 bg-white">
          {slotStats.map((s) => {
            const pct = Math.round(s.completionRate * 100);
            return (
              <tr key={`${s.timeframe}-${s.slot_index}`}>
                <td className="px-4 py-3">
                  <div className="font-semibold text-slate-900">{s.label}</div>
                  <div className="text-xs text-slate-500">{s.timeframe}</div>
                </td>

                <td className="px-4 py-3">
                  <div className="font-semibold text-slate-900">{s.taskTitle}</div>
                </td>

                <td className="px-4 py-3">
                  <div className="font-black text-emerald-700">{s.points}</div>
                  <div className="text-xs text-slate-500">
                    <span title={`Completions: ${s.completions} (rate uses perfect=${s.perfect})`}>YTD</span>
                  </div>
                </td>

                <td className="px-4 py-3">
                  <div className="font-bold text-slate-900">{isNaN(pct) ? 0 : pct}%</div>
                  <div className="mt-1 h-2 w-32 overflow-hidden rounded-full border border-slate-200 bg-slate-50">
                    <div
                      className="h-full bg-emerald-500"
                      style={{ width: `${Math.max(0, Math.min(100, isNaN(pct) ? 0 : pct))}%` }}
                    />
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
          <div className="text-xs text-slate-600">Counts are based on completion history since Jan 1.</div>
        </div>
        <div className="text-sm font-bold text-slate-900">
          Total logged: <span className="text-slate-700">{ytd.total}</span>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
          <div className="text-xs font-bold text-sky-900">Weekly</div>
          <div className="mt-1 text-3xl font-black text-sky-900">{ytd.weekly}</div>
          <div className="text-xs text-sky-800">sessions</div>
        </div>
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
          <div className="text-xs font-bold text-indigo-900">Monthly</div>
          <div className="mt-1 text-3xl font-black text-indigo-900">{ytd.monthly}</div>
          <div className="text-xs text-indigo-800">achievements</div>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="text-xs font-bold text-emerald-900">Yearly</div>
          <div className="mt-1 text-3xl font-black text-emerald-900">{ytd.yearly}</div>
          <div className="text-xs text-emerald-800">milestones</div>
        </div>
      </div>

      {/* simplified stat lines */}
      <MyStatsPanel />

      <div className="mt-8">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-bold text-slate-900">History (by week)</div>
          <div className="text-xs text-slate-500">{historyLoading ? "Loading…" : `Showing up to ${history.length} events`}</div>
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
                            {new Date(r.completed_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                          </td>
                          <td className="px-4 py-3 font-semibold text-slate-900">{r.title ?? `(slot ${r.slot_index + 1})`}</td>
                          <td className="px-4 py-3">
                            <span className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-bold text-slate-700">{r.timeframe}</span>
                          </td>
                          <td className="px-4 py-3 font-bold text-emerald-700">+{pts}</td>
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
            <p className="mt-1 text-sm text-slate-600">Tap a card to check it off.</p>
          </div>

          <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <Avatar src={avatarByHandle[activeUser]} alt={displayName} size={36} />
            <div className="text-sm font-bold text-slate-900">{displayName}</div>
            <div className="text-xs text-slate-500">({activeUser})</div>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-semibold text-slate-900">Today: {seasonClock.today}</div>
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center rounded-xl border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-bold text-sky-800">
                {seasonClock.weekLabel} · {seasonClock.weekRange} · ends in {seasonClock.weekEndsIn}d
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

        {/* Formation first */}
        <div className="mt-6 rounded-3xl border border-slate-200 bg-gradient-to-b from-emerald-50 to-sky-50 p-5 shadow-sm">
          <div className="relative mx-auto max-w-3xl overflow-hidden rounded-3xl border border-emerald-200 bg-emerald-100/40 p-5">
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute left-0 right-0 top-1/2 h-[2px] bg-emerald-200/70" />
              <div className="absolute left-1/2 top-1/2 h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-emerald-200/70" />
            </div>

            {loading ? (
              <div className="relative text-sm text-slate-600">Loading…</div>
            ) : (
              <div className="relative grid gap-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <CheckCard tf="weekly" i={0} label="Weekly 1" />
                  <CheckCard tf="weekly" i={1} label="Weekly 2" />
                  <CheckCard tf="weekly" i={2} label="Weekly 3" />
                </div>

                <div className="mx-auto grid w-full max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
                  <CheckCard tf="monthly" i={0} label="Monthly 1" />
                  <CheckCard tf="monthly" i={1} label="Monthly 2" />
                </div>

                <div className="mx-auto grid w-full max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
                  <CheckCard tf="yearly" i={0} label="Yearly 1" />
                  <CheckCard tf="yearly" i={1} label="Yearly 2" />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Then YTD + simplified stats + history */}
        <YtdAndHistory />
      </div>
    </main>
  );
}
