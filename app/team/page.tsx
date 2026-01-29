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

type TeamPicks = {
  weekly: UserId[];
  monthly: UserId[];
  yearly: UserId[];
};

const ACTIVE_USER_KEY = "fantasy-life:activeUser";

function getActiveUser(): UserId {
  if (typeof window === "undefined") return "alex";
  const raw = localStorage.getItem(ACTIVE_USER_KEY);
  if (raw === "alex" || raw === "bob" || raw === "jeff" || raw === "sean") return raw;
  return "alex";
}

// Time helpers
function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}
function isoWeekKey(d: Date) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  const day = ((date.getDay() + 6) % 7) + 1;
  date.setDate(date.getDate() + (4 - day));
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
function isDoneNow(tf: Timeframe, doneAt: string | null) {
  return doneKey(tf, doneAt) === currentPeriodKey(tf);
}

function FieldRow(props: { children: React.ReactNode }) {
  return <div className="flex w-full justify-center gap-4">{props.children}</div>;
}

function PlayerGoalCard(props: {
  slotLabel: string;
  playerId: UserId;
  goalTitle: string;
  doneNow: boolean;
}) {
  const { slotLabel, playerId, goalTitle, doneNow } = props;
  const playerName = playerId[0].toUpperCase() + playerId.slice(1);

  return (
    <div className="w-full max-w-[260px]">
      <div className="rounded-2xl border border-white/25 bg-white/10 p-3 shadow-sm backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs font-semibold tracking-wide text-white/90">
            {slotLabel} • {playerName}
          </div>

          <label className="flex items-center gap-2 text-white/90">
            <input type="checkbox" checked={doneNow} disabled className="h-4 w-4 accent-white disabled:opacity-80" />
            <span className="text-xs">{doneNow ? "Done" : "Not yet"}</span>
          </label>
        </div>

        <div className="mt-2 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white/95">
          {goalTitle}
        </div>
      </div>
    </div>
  );
}

function PointsCard(props: { weeklyDone: number; monthlyDone: number; yearlyDone: number }) {
  const { weeklyDone, monthlyDone, yearlyDone } = props;
  const points = weeklyDone * 1 + monthlyDone * 4 + yearlyDone * 40;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-sm font-semibold text-slate-700">Points</div>
      <div className="mt-1 text-4xl font-extrabold tracking-tight text-slate-900">{points}</div>

      <div className="mt-3 grid gap-2 text-sm">
        <div className="flex justify-between text-slate-700">
          <span>Weekly done</span>
          <span className="font-semibold">{weeklyDone} × 1</span>
        </div>
        <div className="flex justify-between text-slate-700">
          <span>Monthly done</span>
          <span className="font-semibold">{monthlyDone} × 4</span>
        </div>
        <div className="flex justify-between text-slate-700">
          <span>Yearly done</span>
          <span className="font-semibold">{yearlyDone} × 40</span>
        </div>
      </div>

      <div className="mt-3 text-xs text-slate-500">
        Week: <b>{currentPeriodKey("weekly")}</b> · Month: <b>{currentPeriodKey("monthly")}</b>
      </div>
    </div>
  );
}

export default function TeamPage() {
  const [activeUser, setActiveUser] = useState<UserId>("alex");
  const [loading, setLoading] = useState(true);

  const makeBlank = (user: UserId): TasksState => ({
    weekly: Array.from({ length: 3 }, (_, i) => ({ timeframe: "weekly", slot_index: i, title: `${user}: Weekly goal ${i + 1}`, done_at: null })),
    monthly: Array.from({ length: 2 }, (_, i) => ({ timeframe: "monthly", slot_index: i, title: `${user}: Monthly goal ${i + 1}`, done_at: null })),
    yearly: Array.from({ length: 2 }, (_, i) => ({ timeframe: "yearly", slot_index: i, title: `${user}: Yearly goal ${i + 1}`, done_at: null })),
  });

  const [team, setTeam] = useState<TeamPicks>({
    weekly: ["bob", "jeff", "sean"],
    monthly: ["bob", "jeff"],
    yearly: ["sean", "bob"],
  });

  const [tasksByUser, setTasksByUser] = useState<Record<UserId, TasksState>>({
    alex: makeBlank("alex"),
    bob: makeBlank("bob"),
    jeff: makeBlank("jeff"),
    sean: makeBlank("sean"),
  });

  const loadTeamAndTasks = async (manager: UserId) => {
    setLoading(true);
    setActiveUser(manager);

    const { data: picksData } = await supabase
      .from("team_picks")
      .select("timeframe, slot_index, player_id")
      .eq("manager_id", manager);

    const weekly = Array(3).fill("alex") as UserId[];
    const monthly = Array(2).fill("alex") as UserId[];
    const yearly = Array(2).fill("alex") as UserId[];

    for (const p of (picksData ?? []) as any[]) {
      const tf = p.timeframe as Timeframe;
      const idx = p.slot_index as number;
      const player = p.player_id as UserId;

      if (tf === "weekly" && idx >= 0 && idx < 3) weekly[idx] = player;
      if (tf === "monthly" && idx >= 0 && idx < 2) monthly[idx] = player;
      if (tf === "yearly" && idx >= 0 && idx < 2) yearly[idx] = player;
    }
    setTeam({ weekly, monthly, yearly });

    const { data: rows } = await supabase
      .from("tasks")
      .select("user_id, timeframe, slot_index, title, done_at")
      .in("user_id", ["alex", "bob", "jeff", "sean"]);

    const next: Record<UserId, TasksState> = {
      alex: makeBlank("alex"),
      bob: makeBlank("bob"),
      jeff: makeBlank("jeff"),
      sean: makeBlank("sean"),
    };

    for (const r of (rows ?? []) as any[]) {
      const user = r.user_id as UserId;
      const tf = r.timeframe as Timeframe;
      const idx = r.slot_index as number;
      const g: Goal = { timeframe: tf, slot_index: idx, title: r.title ?? "", done_at: r.done_at ?? null };

      if (tf === "weekly" && idx >= 0 && idx < 3) next[user].weekly[idx] = g;
      if (tf === "monthly" && idx >= 0 && idx < 2) next[user].monthly[idx] = g;
      if (tf === "yearly" && idx >= 0 && idx < 2) next[user].yearly[idx] = g;
    }

    setTasksByUser(next);
    setLoading(false);
  };

  useEffect(() => {
    loadTeamAndTasks(getActiveUser());
    const handler = () => loadTeamAndTasks(getActiveUser());
    window.addEventListener("fantasy-life:activeUserChanged", handler);
    return () => window.removeEventListener("fantasy-life:activeUserChanged", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("team-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => loadTeamAndTasks(getActiveUser()))
      .on("postgres_changes", { event: "*", schema: "public", table: "team_picks" }, () => loadTeamAndTasks(getActiveUser()))
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { weeklyDone, monthlyDone, yearlyDone } = useMemo(() => {
    let w = 0, m = 0, y = 0;
    team.weekly.forEach((playerId, idx) => {
      const g = tasksByUser[playerId]?.weekly?.[idx];
      if (g && isDoneNow("weekly", g.done_at)) w += 1;
    });
    team.monthly.forEach((playerId, idx) => {
      const g = tasksByUser[playerId]?.monthly?.[idx];
      if (g && isDoneNow("monthly", g.done_at)) m += 1;
    });
    team.yearly.forEach((playerId, idx) => {
      const g = tasksByUser[playerId]?.yearly?.[idx];
      if (g && isDoneNow("yearly", g.done_at)) y += 1;
    });
    return { weeklyDone: w, monthlyDone: m, yearlyDone: y };
  }, [team, tasksByUser]);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-6xl px-5 py-8">
        <h1 className="text-3xl font-bold tracking-tight">{activeUser.toUpperCase()}'s Team</h1>
        <p className="mt-1 text-sm text-slate-600">{loading ? "Loading…" : "Read-only team view + points."}</p>

        <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
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
                        {team.weekly.map((playerId, idx) => {
                          const g = tasksByUser[playerId]?.weekly?.[idx];
                          return (
                            <PlayerGoalCard
                              key={`w-${idx}`}
                              slotLabel={`W${idx + 1}`}
                              playerId={playerId}
                              goalTitle={g?.title ?? "(missing)"}
                              doneNow={!!g && isDoneNow("weekly", g.done_at)}
                            />
                          );
                        })}
                      </FieldRow>
                    </div>

                    <div>
                      <div className="mb-2 text-center text-sm font-semibold text-white/95">Monthly (2)</div>
                      <FieldRow>
                        {team.monthly.map((playerId, idx) => {
                          const g = tasksByUser[playerId]?.monthly?.[idx];
                          return (
                            <PlayerGoalCard
                              key={`m-${idx}`}
                              slotLabel={`M${idx + 1}`}
                              playerId={playerId}
                              goalTitle={g?.title ?? "(missing)"}
                              doneNow={!!g && isDoneNow("monthly", g.done_at)}
                            />
                          );
                        })}
                      </FieldRow>
                    </div>

                    <div>
                      <div className="mb-2 text-center text-sm font-semibold text-white/95">Yearly (2)</div>
                      <FieldRow>
                        {team.yearly.map((playerId, idx) => {
                          const g = tasksByUser[playerId]?.yearly?.[idx];
                          return (
                            <PlayerGoalCard
                              key={`y-${idx}`}
                              slotLabel={`Y${idx + 1}`}
                              playerId={playerId}
                              goalTitle={g?.title ?? "(missing)"}
                              doneNow={!!g && isDoneNow("yearly", g.done_at)}
                            />
                          );
                        })}
                      </FieldRow>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="lg:sticky lg:top-5 h-fit">
            <PointsCard weeklyDone={weeklyDone} monthlyDone={monthlyDone} yearlyDone={yearlyDone} />
            <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-600 shadow-sm">
              Weekly/monthly reset automatically because we only count done_at in the current week/month.
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
