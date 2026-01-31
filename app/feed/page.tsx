"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";

type Timeframe = "weekly" | "monthly" | "yearly";

type TaskRow = {
  user_id: string;
  timeframe: Timeframe;
  slot_index: number;
  title: string;
  done_at: string | null;
};

type PickRow = {
  manager_id: string;
  timeframe: Timeframe;
  slot_index: number;
  player_id: string;
};

const POINTS: Record<Timeframe, number> = { weekly: 1, monthly: 4, yearly: 40 };

function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

function isoWeekKey(d: Date) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);

  const day = ((date.getDay() + 6) % 7) + 1; // Mon=1..Sun=7
  date.setDate(date.getDate() + (4 - day)); // move to Thursday

  const year = date.getFullYear();
  const yearStart = new Date(year, 0, 1);
  yearStart.setHours(0, 0, 0, 0);

  const diffDays = Math.floor((date.getTime() - yearStart.getTime()) / 86400000);
  const week = Math.floor(diffDays / 7) + 1;

  return `${year}-W${pad2(week)}`;
}

function isoWeekStart(d: Date) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  const day = (date.getDay() + 6) % 7; // Mon=0..Sun=6
  date.setDate(date.getDate() - day); // back to Monday
  return date;
}

function weekKeyToStart(weekKey: string) {
  const [yStr, wStr] = weekKey.split("-W");
  const year = Number(yStr);
  const week = Number(wStr);

  const jan4 = new Date(year, 0, 4);
  const week1Start = isoWeekStart(jan4);

  const start = new Date(week1Start);
  start.setDate(start.getDate() + (week - 1) * 7);
  return start;
}

function formatWeekLabel(weekKey: string) {
  const [y, w] = weekKey.split("-W");
  return `Week ${w} (${y})`;
}

function seededIndex(seed: string, length: number) {
  if (length <= 0) return 0;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % length;
}

function fallbackNameFromId(id: string) {
  if (!id) return "Someone";
  return id.charAt(0).toUpperCase() + id.slice(1);
}

type RankingRow = { id: string; points: number };
type TotalRankingRow = { id: string; totalPoints: number; weekDelta: number };

type WeeklyPost = {
  weekKey: string;
  dateLabel: string;
  text: string;
  mvp: RankingRow;
  lvp: RankingRow;
  totalRankings: TotalRankingRow[];
};

function badgeClasses(rankIdx: number) {
  if (rankIdx === 0) return "bg-amber-100 text-amber-800 border-amber-200";
  if (rankIdx === 1) return "bg-slate-100 text-slate-800 border-slate-200";
  if (rankIdx === 2) return "bg-orange-100 text-orange-800 border-orange-200";
  return "bg-emerald-50 text-emerald-800 border-emerald-200";
}

export default function FeedPage() {
  const [loading, setLoading] = useState(true);
  const [posts, setPosts] = useState<WeeklyPost[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [nameById, setNameById] = useState<Record<string, string>>({});

  const todayLabel = useMemo(() => {
    return new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  }, []);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      setErrorMsg(null);

      const [tasksRes, picksRes] = await Promise.all([
        supabase.from("tasks").select("user_id,timeframe,slot_index,title,done_at"),
        supabase.from("team_picks").select("manager_id,timeframe,slot_index,player_id"),
      ]);

      if (tasksRes.error) {
        setErrorMsg(`Failed to load tasks: ${tasksRes.error.message}`);
        setLoading(false);
        return;
      }
      if (picksRes.error) {
        setErrorMsg(`Failed to load team picks: ${picksRes.error.message}`);
        setLoading(false);
        return;
      }

      const tasks = (tasksRes.data ?? []) as TaskRow[];
      const picks = (picksRes.data ?? []) as PickRow[];

      // Discover users dynamically
      const userSet = new Set<string>();
      for (const t of tasks) userSet.add(t.user_id);
      for (const p of picks) {
        userSet.add(p.manager_id);
        userSet.add(p.player_id);
      }
      const allUserIds = Array.from(userSet);

      // Default names
      const nextNameById: Record<string, string> = {};
      for (const id of allUserIds) nextNameById[id] = fallbackNameFromId(id);

      // Optional: profiles table support (safe if it doesn't exist)
      try {
        const profRes = await supabase.from("profiles").select("id, display_name").in("id", allUserIds);
        if (!profRes.error && profRes.data) {
          for (const row of profRes.data as any[]) {
            if (row?.id && row?.display_name) {
              nextNameById[String(row.id)] = String(row.display_name);
            }
          }
        }
      } catch {}

      setNameById(nextNameById);

      // Determine managers (ranking list)
      const managerSet = new Set<string>();
      for (const p of picks) managerSet.add(p.manager_id);
      const managerIds = Array.from(managerSet);

      // Week set from done_at plus current week
      const weekSet = new Set<string>();
      weekSet.add(isoWeekKey(new Date()));
      for (const t of tasks) if (t.done_at) weekSet.add(isoWeekKey(new Date(t.done_at)));

      const HISTORY_WEEKS = 20;
      const weekKeys = Array.from(weekSet).sort(
        (a, b) => weekKeyToStart(b).getTime() - weekKeyToStart(a).getTime()
      );
      const feedWeeks = weekKeys.slice(0, HISTORY_WEEKS);

      // Index task completion week by (user,timeframe,slot)
      const taskKey = (userId: string, tf: Timeframe, slot: number) => `${userId}|${tf}|${slot}`;
      const doneWeekByTaskKey = new Map<string, string | null>();
      for (const t of tasks) {
        doneWeekByTaskKey.set(taskKey(t.user_id, t.timeframe, t.slot_index), t.done_at ? isoWeekKey(new Date(t.done_at)) : null);
      }

      // Completed tasks + user points by week (for MVP/LVP)
      const completedTasksByWeek = new Map<string, TaskRow[]>();
      const userPointsByWeek = new Map<string, Map<string, number>>();
      for (const wk of feedWeeks) {
        completedTasksByWeek.set(wk, []);
        userPointsByWeek.set(wk, new Map<string, number>());
      }

      for (const t of tasks) {
        if (!t.done_at) continue;
        const wk = isoWeekKey(new Date(t.done_at));
        if (!completedTasksByWeek.has(wk)) continue;
        completedTasksByWeek.get(wk)!.push(t);

        const m = userPointsByWeek.get(wk)!;
        m.set(t.user_id, (m.get(t.user_id) ?? 0) + POINTS[t.timeframe]);
      }

      // Manager points by week
      const managerPointsByWeek = new Map<string, Map<string, number>>();
      for (const wk of feedWeeks) managerPointsByWeek.set(wk, new Map<string, number>());

      for (const p of picks) {
        const draftedDoneWeek = doneWeekByTaskKey.get(taskKey(p.player_id, p.timeframe, p.slot_index)) ?? null;
        if (!draftedDoneWeek) continue;
        if (!managerPointsByWeek.has(draftedDoneWeek)) continue;

        const m = managerPointsByWeek.get(draftedDoneWeek)!;
        m.set(p.manager_id, (m.get(p.manager_id) ?? 0) + POINTS[p.timeframe]);
      }

      // Cumulative manager points up to each week (chronological)
      const chronoWeeks = [...feedWeeks].sort(
        (a, b) => weekKeyToStart(a).getTime() - weekKeyToStart(b).getTime()
      );

      const runningTotals = new Map<string, number>();
      const cumulativeByWeek = new Map<string, Map<string, number>>();

      for (const wk of chronoWeeks) {
        const wkMap = managerPointsByWeek.get(wk)!;
        for (const [mgr, pts] of wkMap.entries()) {
          runningTotals.set(mgr, (runningTotals.get(mgr) ?? 0) + pts);
        }
        cumulativeByWeek.set(wk, new Map<string, number>(runningTotals));
      }

      const toSortedTotals = (wk: string): TotalRankingRow[] => {
        const weekMap = managerPointsByWeek.get(wk) ?? new Map<string, number>();
        const cumMap = cumulativeByWeek.get(wk) ?? new Map<string, number>();

        const rows: TotalRankingRow[] = managerIds.map((id) => ({
          id,
          weekDelta: weekMap.get(id) ?? 0,
          totalPoints: cumMap.get(id) ?? 0,
        }));

        rows.sort((a, b) => b.totalPoints - a.totalPoints || b.weekDelta - a.weekDelta || a.id.localeCompare(b.id));
        return rows;
      };

      const toMvpLvp = (wk: string): { mvp: RankingRow; lvp: RankingRow } => {
        const up = userPointsByWeek.get(wk) ?? new Map<string, number>();

        // include all users to avoid empty issues
        for (const uid of allUserIds) if (!up.has(uid)) up.set(uid, 0);

        const arr: RankingRow[] = Array.from(up.entries()).map(([id, points]) => ({ id, points }));
        // MVP: points desc, then id asc
        arr.sort((a, b) => b.points - a.points || a.id.localeCompare(b.id));
        const mvp = arr[0] ?? { id: "someone", points: 0 };

        // LVP: points asc, then id asc (deterministic)
        const lvpArr = [...arr].sort((a, b) => a.points - b.points || a.id.localeCompare(b.id));
        const lvp = lvpArr[0] ?? { id: "someone", points: 0 };

        return { mvp, lvp };
      };

      // Build weekly posts
      const built: WeeklyPost[] = feedWeeks.map((wk) => {
        const start = weekKeyToStart(wk);
        const mondayLabel = start.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

        const completedList = completedTasksByWeek.get(wk) ?? [];
        const completedPick =
          completedList.length > 0 ? completedList[seededIndex(`completed|${wk}`, completedList.length)] : null;

        // Choose a task NOT completed in that week (stable)
        const notDonePick = (() => {
          if (tasks.length === 0) return null;
          const base = seededIndex(`notdone|${wk}`, tasks.length);

          for (let k = 0; k < Math.min(10, tasks.length); k++) {
            const t = tasks[(base + k) % tasks.length];
            const doneWk = t.done_at ? isoWeekKey(new Date(t.done_at)) : null;
            if (doneWk !== wk) return t;
          }
          return tasks[base];
        })();

        const completedLine = completedPick
          ? `${nextNameById[completedPick.user_id] ?? fallbackNameFromId(completedPick.user_id)} did ${completedPick.title}`
          : `Someone did something`;

        const notDoneLine = notDonePick
          ? `${nextNameById[notDonePick.user_id] ?? fallbackNameFromId(notDonePick.user_id)} did not ${notDonePick.title}`
          : `Someone did not something`;

        const text = `${mondayLabel}: This week, ${completedLine} ...wow. ${notDoneLine}.`;

        const { mvp, lvp } = toMvpLvp(wk);

        return {
          weekKey: wk,
          dateLabel: mondayLabel,
          text,
          mvp,
          lvp,
          totalRankings: toSortedTotals(wk),
        };
      });

      built.sort((a, b) => weekKeyToStart(b.weekKey).getTime() - weekKeyToStart(a.weekKey).getTime());
      setPosts(built);
      setLoading(false);
    };

    run();
  }, [todayLabel]);

  const showName = (id: string) => nameById[id] ?? fallbackNameFromId(id);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-4xl px-5 py-8">
        <h1 className="text-3xl font-bold tracking-tight">News Feed</h1>
        <p className="mt-1 text-sm text-slate-600">Running weekly history (auto-generated). Today is {todayLabel}.</p>

        {loading ? (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
            Loading…
          </div>
        ) : errorMsg ? (
          <div className="mt-6 rounded-2xl border border-red-200 bg-white p-5 text-sm text-red-600 shadow-sm">
            {errorMsg}
          </div>
        ) : (
          <div className="mt-6 flex flex-col gap-4">
            {posts.map((p) => (
              <div key={p.weekKey} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-slate-700">{formatWeekLabel(p.weekKey)}</div>
                  <div className="text-xs text-slate-500">{p.dateLabel}</div>
                </div>

                <div className="mt-3 text-base leading-relaxed text-slate-900">{p.text}</div>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs font-semibold text-slate-600">MVP (this week)</div>
                    <div className="mt-1 text-sm font-bold text-slate-900">
                      {showName(p.mvp.id)} — {p.mvp.points} pts
                    </div>

                    <div className="mt-3 text-xs font-semibold text-slate-600">LVP (this week)</div>
                    <div className="mt-1 text-sm font-bold text-slate-900">
                      {showName(p.lvp.id)} — {p.lvp.points} pts
                    </div>

                    <div className="mt-2 text-[11px] text-slate-500">
                      (Later: quarterly “LVP punishment” is easy to add by aggregating these week scores.)
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 sm:col-span-2">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold text-slate-600">Total rankings</div>
                      <div className="text-[11px] text-slate-500">Total points ( + this week )</div>
                    </div>

                    <ol className="mt-2 space-y-2">
                      {p.totalRankings.map((r, i) => (
                        <li
                          key={`${p.weekKey}-${r.id}`}
                          className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2"
                        >
                          <div className="flex items-center gap-3">
                            <span
                              className={`inline-flex items-center rounded-lg border px-2 py-1 text-xs font-bold ${badgeClasses(
                                i
                              )}`}
                            >
                              #{i + 1}
                            </span>
                            <span className="text-sm font-semibold text-slate-900">{showName(r.id)}</span>
                          </div>

                          <div className="flex items-center gap-3">
                            <span className="text-sm font-bold text-slate-900">{r.totalPoints}</span>

                            <span
                              className={[
                                "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-bold",
                                r.weekDelta > 0
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                  : "border-slate-200 bg-slate-50 text-slate-600",
                              ].join(" ")}
                              title="Points gained this week"
                            >
                              <span
                                className={[
                                  "inline-flex h-5 w-5 items-center justify-center rounded-md text-[11px]",
                                  r.weekDelta > 0 ? "bg-emerald-600 text-white" : "bg-slate-400 text-white",
                                ].join(" ")}
                              >
                                +
                              </span>
                              {r.weekDelta}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>

                <div className="mt-3 text-xs text-slate-500">
                  Note: goals only count for the week their <code>done_at</code> timestamp occurred (yearly goals included).
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
