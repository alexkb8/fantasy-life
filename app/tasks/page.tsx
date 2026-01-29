"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";

type UserId = "alex" | "bob" | "jeff" | "sean";
type Timeframe = "weekly" | "monthly" | "yearly";

type Goal = {
  timeframe: Timeframe;
  slot_index: number;
  title: string;
  done_at: string | null;
};

type TasksState = {
  weekly: Goal[];  // 3
  monthly: Goal[]; // 2
  yearly: Goal[];  // 2
};

const ACTIVE_USER_KEY = "fantasy-life:activeUser";

function getActiveUser(): UserId {
  if (typeof window === "undefined") return "alex";
  const raw = localStorage.getItem(ACTIVE_USER_KEY);
  if (raw === "alex" || raw === "bob" || raw === "jeff" || raw === "sean") return raw;
  return "alex";
}

// -------- Time helpers (local time) --------
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
function monthKey(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}
function yearKey(d: Date) {
  return `${d.getFullYear()}`;
}
function currentPeriodKey(tf: Timeframe) {
  const now = new Date();
  if (tf === "weekly") return isoWeekKey(now);
  if (tf === "monthly") return monthKey(now);
  return yearKey(now);
}
function doneKey(tf: Timeframe, doneAt: string | null) {
  if (!doneAt) return null;
  const d = new Date(doneAt);
  if (tf === "weekly") return isoWeekKey(d);
  if (tf === "monthly") return monthKey(d);
  return yearKey(d);
}
function isDoneNow(goal: Goal) {
  return doneKey(goal.timeframe, goal.done_at) === currentPeriodKey(goal.timeframe);
}

// -------- UI --------
function FieldRow(props: { children: React.ReactNode }) {
  return <div className="flex w-full justify-center gap-4">{props.children}</div>;
}

function GoalCard(props: {
  label: string;
  goal: Goal;
  doneNow: boolean;
  onToggle: () => void;
  onTitleChange: (title: string) => void;
}) {
  const { label, goal, doneNow, onToggle, onTitleChange } = props;

  return (
    <div className="w-full max-w-[260px]">
      <div className="rounded-2xl border border-white/25 bg-white/10 p-3 shadow-sm backdrop-blur hover:bg-white/15 transition">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs font-semibold tracking-wide text-white/90">{label}</div>
          <label className="flex items-center gap-2 text-white/90">
            <input type="checkbox" checked={doneNow} onChange={onToggle} className="h-4 w-4 accent-white" />
            <span className="text-xs">{doneNow ? "Done" : "Not yet"}</span>
          </label>
        </div>

        <input
          value={goal.title}
          onChange={(e) => onTitleChange(e.target.value)}
          className="mt-2 w-full rounded-xl border border-white/25 bg-white/95 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-white/60"
        />

        <div className="mt-2 text-xs text-white/85">
          {doneNow ? `✅ Completed this ${goal.timeframe}` : `⏳ Not completed this ${goal.timeframe}`}
        </div>
      </div>
    </div>
  );
}

export default function TasksPage() {
  const [activeUser, setActiveUser] = useState<UserId>("alex");
  const [loading, setLoading] = useState(true);
  const [lastError, setLastError] = useState<string | null>(null);

  const blankFor = (user: UserId): TasksState => ({
    weekly: Array.from({ length: 3 }, (_, i) => ({
      timeframe: "weekly",
      slot_index: i,
      title: `${user.toUpperCase()}: Weekly goal ${i + 1}`,
      done_at: null,
    })),
    monthly: Array.from({ length: 2 }, (_, i) => ({
      timeframe: "monthly",
      slot_index: i,
      title: `${user.toUpperCase()}: Monthly goal ${i + 1}`,
      done_at: null,
    })),
    yearly: Array.from({ length: 2 }, (_, i) => ({
      timeframe: "yearly",
      slot_index: i,
      title: `${user.toUpperCase()}: Yearly goal ${i + 1}`,
      done_at: null,
    })),
  });

  const [tasks, setTasks] = useState<TasksState>(blankFor("alex"));

  const loadTasks = async (userId: UserId) => {
    setLoading(true);
    setActiveUser(userId);
    setLastError(null);

    const { data, error } = await supabase
      .from("tasks")
      .select("timeframe, slot_index, title, done_at")
      .eq("user_id", userId);

    const next = blankFor(userId);

    if (error) {
      setLastError(`Load failed: ${error.message}`);
      setTasks(next);
      setLoading(false);
      return;
    }

    for (const row of (data ?? []) as any[]) {
      const tf = row.timeframe as Timeframe;
      const idx = row.slot_index as number;
      const g: Goal = {
        timeframe: tf,
        slot_index: idx,
        title: row.title ?? next[tf][idx]?.title ?? "",
        done_at: row.done_at ?? null,
      };

      if (tf === "weekly" && idx >= 0 && idx < 3) next.weekly[idx] = g;
      if (tf === "monthly" && idx >= 0 && idx < 2) next.monthly[idx] = g;
      if (tf === "yearly" && idx >= 0 && idx < 2) next.yearly[idx] = g;
    }

    setTasks(next);
    setLoading(false);
  };

  useEffect(() => {
    loadTasks(getActiveUser());
    const handler = () => loadTasks(getActiveUser());
    window.addEventListener("fantasy-life:activeUserChanged", handler);
    return () => window.removeEventListener("fantasy-life:activeUserChanged", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // realtime refresh
  useEffect(() => {
    const channel = supabase
      .channel("tasks-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => loadTasks(getActiveUser()))
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Helper: get current goal from state
  const getGoal = (tf: Timeframe, idx: number): Goal => {
    if (tf === "weekly") return tasks.weekly[idx];
    if (tf === "monthly") return tasks.monthly[idx];
    return tasks.yearly[idx];
  };

  // ✅ FIXED: Always upsert full row with NOT NULL title
  const saveGoal = async (tf: Timeframe, idx: number, patch: Partial<Pick<Goal, "title" | "done_at">>) => {
    setLastError(null);

    const current = getGoal(tf, idx);
    const nextGoal: Goal = {
      ...current,
      ...patch,
      title: (patch.title ?? current.title ?? "").trim() || "Untitled goal",
    };

    // optimistic update
    setTasks((prev) => {
      const clone: TasksState = {
        weekly: prev.weekly.map((g) => ({ ...g })),
        monthly: prev.monthly.map((g) => ({ ...g })),
        yearly: prev.yearly.map((g) => ({ ...g })),
      };
      if (tf === "weekly") clone.weekly[idx] = nextGoal;
      if (tf === "monthly") clone.monthly[idx] = nextGoal;
      if (tf === "yearly") clone.yearly[idx] = nextGoal;
      return clone;
    });

    const { error } = await supabase.from("tasks").upsert(
      {
        user_id: activeUser,
        timeframe: tf,
        slot_index: idx,
        title: nextGoal.title,      // <-- ALWAYS include
        done_at: nextGoal.done_at,  // <-- ALWAYS include
      },
      { onConflict: "user_id,timeframe,slot_index" }
    );

    if (error) {
      setLastError(`Save failed: ${error.message}`);
      await loadTasks(activeUser); // revert to truth
    }
  };

  const toggle = (tf: Timeframe, idx: number) => {
    const g = getGoal(tf, idx);
    const nowDone = isDoneNow(g);
    saveGoal(tf, idx, { done_at: nowDone ? null : new Date().toISOString() });
  };

  const completed = useMemo(() => {
    const all = [...tasks.weekly, ...tasks.monthly, ...tasks.yearly];
    return all.filter((g) => isDoneNow(g)).length;
  }, [tasks]);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-5xl px-5 py-8">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{activeUser.toUpperCase()}'s Tasks</h1>
            <p className="mt-1 text-sm text-slate-600">
              {loading ? "Loading…" : <>Completed this period: <span className="font-semibold text-slate-900">{completed}</span> / 7</>}
            </p>
            {lastError && <p className="mt-1 text-sm text-red-600">{lastError}</p>}
          </div>
          <div className="text-xs text-slate-500">
            Week: <b>{currentPeriodKey("weekly")}</b> · Month: <b>{currentPeriodKey("monthly")}</b>
          </div>
        </div>

        <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="rounded-3xl bg-gradient-to-b from-emerald-700 to-emerald-600 p-5 shadow-inner">
            <div className="relative rounded-3xl border border-white/30 p-5 min-h-[720px]">
              <div className="pointer-events-none absolute inset-0 rounded-3xl">
                <div className="absolute top-1/2 left-0 w-full h-px -translate-y-1/2 bg-white/20" />
                <div className="absolute left-1/2 top-1/2 h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/20" />
                <div className="absolute left-1/2 top-4 h-20 w-56 -translate-x-1/2 rounded-2xl border border-white/15" />
                <div className="absolute left-1/2 bottom-4 h-20 w-56 -translate-x-1/2 rounded-2xl border border-white/15" />
              </div>

              {!loading && (
                <div className="relative flex flex-col gap-6">
                  <div>
                    <div className="mb-2 text-center text-sm font-semibold text-white/95">Weekly (3)</div>
                    <FieldRow>
                      {tasks.weekly.map((g, i) => (
                        <GoalCard
                          key={`w-${i}`}
                          label={`W${i + 1}`}
                          goal={g}
                          doneNow={isDoneNow(g)}
                          onToggle={() => toggle("weekly", i)}
                          onTitleChange={(title) => saveGoal("weekly", i, { title })}
                        />
                      ))}
                    </FieldRow>
                  </div>

                  <div>
                    <div className="mb-2 text-center text-sm font-semibold text-white/95">Monthly (2)</div>
                    <FieldRow>
                      {tasks.monthly.map((g, i) => (
                        <GoalCard
                          key={`m-${i}`}
                          label={`M${i + 1}`}
                          goal={g}
                          doneNow={isDoneNow(g)}
                          onToggle={() => toggle("monthly", i)}
                          onTitleChange={(title) => saveGoal("monthly", i, { title })}
                        />
                      ))}
                    </FieldRow>
                  </div>

                  <div>
                    <div className="mb-2 text-center text-sm font-semibold text-white/95">Yearly (2)</div>
                    <FieldRow>
                      {tasks.yearly.map((g, i) => (
                        <GoalCard
                          key={`y-${i}`}
                          label={`Y${i + 1}`}
                          goal={g}
                          doneNow={isDoneNow(g)}
                          onToggle={() => toggle("yearly", i)}
                          onTitleChange={(title) => saveGoal("yearly", i, { title })}
                        />
                      ))}
                    </FieldRow>
                  </div>
                </div>
              )}
            </div>
          </div>

          <p className="mt-4 text-xs text-slate-500">
            Weekly/monthly “reset” automatically: completion counts only if done_at is in the current week/month.
          </p>
        </div>
      </div>
    </main>
  );
}
