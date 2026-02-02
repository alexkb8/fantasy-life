"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import Avatar from "../components/Avatar";

type Timeframe = "weekly" | "monthly" | "yearly";
const POINTS: Record<Timeframe, number> = { weekly: 1, monthly: 4, yearly: 40 };
const SLOT_COUNTS: Record<Timeframe, number> = { weekly: 3, monthly: 2, yearly: 2 };

type PickRow = { manager_id: string; timeframe: Timeframe; slot_index: number; player_id: string };
type TaskRow = { user_id: string; timeframe: Timeframe; slot_index: number; title: string; done_at: string | null };
type ProfileRow = { handle: string | null; display_name: string | null; avatar_url: string | null };
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

function pickKey(tf: Timeframe, i: number) {
  return `${tf}:${i}`;
}
function taskKey(u: string, tf: Timeframe, i: number) {
  return `${u}|${tf}|${i}`;
}
function slotLabel(tf: Timeframe, i: number) {
  const base = tf === "weekly" ? "Weekly" : tf === "monthly" ? "Monthly" : "Yearly";
  return `${base} ${i + 1}`;
}

/** time helpers */
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

type TeamYtd = { weekly: number; monthly: number; yearly: number; totalCompletions: number; totalPoints: number };

type TeamHistoryRow = CompletionRow & {
  playerName: string;
  playerAvatar: string | null;
  pts: number;
};

type SlotStat = {
  timeframe: Timeframe;
  slot_index: number;
  label: string;

  playerHandle: string | null;
  playerName: string;
  playerAvatar: string | null;

  taskTitle: string;

  completions: number; // for internal calc + tooltip
  perfect: number;     // for internal calc + tooltip
  completionRate: number;

  points: number;      // show this
};

export default function TeamPage() {
  const [activeUser, setActiveUser] = useState<UserId>("alex");

  const [nameByHandle, setNameByHandle] = useState<Record<string, string>>({});
  const [avatarByHandle, setAvatarByHandle] = useState<Record<string, string>>({});

  const [picksBySlot, setPicksBySlot] = useState<Record<string, PickRow | null>>({});
  const [tasksByKey, setTasksByKey] = useState<Record<string, TaskRow>>({});

  const [teamYtd, setTeamYtd] = useState<TeamYtd>({
    weekly: 0,
    monthly: 0,
    yearly: 0,
    totalCompletions: 0,
    totalPoints: 0,
  });

  const [teamHistory, setTeamHistory] = useState<TeamHistoryRow[]>([]);
  const [slotStats, setSlotStats] = useState<SlotStat[]>([]);

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    setActiveUser(getActiveUser());
    const onChange = () => setActiveUser(getActiveUser());
    window.addEventListener("fantasy-life:activeUserChanged", onChange);
    return () => window.removeEventListener("fantasy-life:activeUserChanged", onChange);
  }, []);

  const managerName = useMemo(() => {
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

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setMsg("");

      // 1) Profiles
      const profRes = await supabase.from("profiles").select("handle, display_name, avatar_url");
      const localNames: Record<string, string> = {};
      const localAvatars: Record<string, string> = {};
      if (!profRes.error) {
        for (const r of (profRes.data ?? []) as ProfileRow[]) {
          if (!r.handle) continue;
          localNames[r.handle] = r.display_name || r.handle;
          if (r.avatar_url) localAvatars[r.handle] = r.avatar_url;
        }
      }
      if (cancelled) return;
      setNameByHandle(localNames);
      setAvatarByHandle(localAvatars);

      // 2) Picks
      const pRes = await supabase
        .from("team_picks")
        .select("manager_id,timeframe,slot_index,player_id")
        .eq("manager_id", activeUser);

      if (pRes.error) {
        if (!cancelled) setMsg(pRes.error.message);
        if (!cancelled) setLoading(false);
        return;
      }

      const picks = (pRes.data ?? []) as PickRow[];
      const bySlot: Record<string, PickRow | null> = {};
      (["weekly", "monthly", "yearly"] as Timeframe[]).forEach((tf) => {
        for (let i = 0; i < SLOT_COUNTS[tf]; i++) bySlot[pickKey(tf, i)] = null;
      });
      for (const p of picks) bySlot[pickKey(p.timeframe, p.slot_index)] = p;

      if (cancelled) return;
      setPicksBySlot(bySlot);

      const draftedPlayers = Array.from(new Set(picks.map((p) => p.player_id)));
      if (draftedPlayers.length === 0) {
        if (!cancelled) {
          setTasksByKey({});
          setTeamYtd({ weekly: 0, monthly: 0, yearly: 0, totalCompletions: 0, totalPoints: 0 });
          setTeamHistory([]);
          setSlotStats([]);
          setLoading(false);
        }
        return;
      }

      // 3) Tasks for display
      const tRes = await supabase
        .from("tasks")
        .select("user_id,timeframe,slot_index,title,done_at")
        .in("user_id", draftedPlayers);

      if (tRes.error) {
        if (!cancelled) setMsg(tRes.error.message);
        if (!cancelled) setLoading(false);
        return;
      }

      const tmap: Record<string, TaskRow> = {};
      for (const t of (tRes.data ?? []) as TaskRow[]) {
        tmap[taskKey(t.user_id, t.timeframe, t.slot_index)] = t;
      }
      if (cancelled) return;
      setTasksByKey(tmap);

      // 4) History YTD
      const cRes = await supabase
        .from("task_completions")
        .select("id,user_id,timeframe,slot_index,title,completed_at")
        .in("user_id", draftedPlayers)
        .gte("completed_at", startOfYearISO)
        .order("completed_at", { ascending: false })
        .limit(800);

      if (cRes.error) {
        if (!cancelled) setLoading(false);
        return;
      }

      const pickSet = new Set<string>();
      for (const p of picks) pickSet.add(`${p.player_id}|${p.timeframe}|${p.slot_index}`);

      const now = new Date();

      const y: TeamYtd = { weekly: 0, monthly: 0, yearly: 0, totalCompletions: 0, totalPoints: 0 };
      const filteredHistory: TeamHistoryRow[] = [];
      const slotCountMap = new Map<string, number>();

      for (const row of (cRes.data ?? []) as CompletionRow[]) {
        const tf = row.timeframe as Timeframe;
        if (tf !== "weekly" && tf !== "monthly" && tf !== "yearly") continue;

        const k = `${row.user_id}|${tf}|${row.slot_index}`;
        if (!pickSet.has(k)) continue;

        const pts = POINTS[tf];

        y[tf] += 1;
        y.totalCompletions += 1;
        y.totalPoints += pts;

        filteredHistory.push({
          ...row,
          playerName: localNames[row.user_id] ?? row.user_id,
          playerAvatar: localAvatars[row.user_id] ?? null,
          pts,
        });

        slotCountMap.set(k, (slotCountMap.get(k) ?? 0) + 1);
      }

      const stats: SlotStat[] = [];
      (["weekly", "monthly", "yearly"] as Timeframe[]).forEach((tf) => {
        for (let i = 0; i < SLOT_COUNTS[tf]; i++) {
          const pick = bySlot[pickKey(tf, i)];
          const playerHandle = pick?.player_id ?? null;

          const playerName = playerHandle ? localNames[playerHandle] ?? playerHandle : "—";
          const playerAvatar = playerHandle ? localAvatars[playerHandle] ?? null : null;

          const key = playerHandle ? `${playerHandle}|${tf}|${i}` : "";
          const completions = playerHandle ? slotCountMap.get(key) ?? 0 : 0;

          const perfect = perfectCountYTD(tf, now);
          const completionRate = perfect > 0 ? completions / perfect : 0;

          const points = completions * POINTS[tf];

          const currentTaskTitle =
            playerHandle && tmap[taskKey(playerHandle, tf, i)]?.title
              ? tmap[taskKey(playerHandle, tf, i)]!.title
              : `(${slotLabel(tf, i)})`;

          stats.push({
            timeframe: tf,
            slot_index: i,
            label: slotLabel(tf, i),
            playerHandle,
            playerName,
            playerAvatar,
            taskTitle: currentTaskTitle,
            completions,
            perfect,
            completionRate,
            points,
          });
        }
      });

      if (cancelled) return;
      setTeamYtd(y);
      setTeamHistory(filteredHistory);
      setSlotStats(stats);
      setLoading(false);
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [activeUser, startOfYearISO]);

  const totalPointsNow = useMemo(() => {
    let sum = 0;
    for (const tf of ["weekly", "monthly", "yearly"] as Timeframe[]) {
      for (let i = 0; i < SLOT_COUNTS[tf]; i++) {
        const p = picksBySlot[pickKey(tf, i)];
        if (!p) continue;
        const t = tasksByKey[taskKey(p.player_id, tf, i)];
        if (t?.done_at) sum += POINTS[tf];
      }
    }
    return sum;
  }, [picksBySlot, tasksByKey]);

  const SlotCard = ({ tf, i, label }: { tf: Timeframe; i: number; label: string }) => {
    const p = picksBySlot[pickKey(tf, i)];
    const empty = !p;

    const playerHandle = p?.player_id ?? "";
    const playerName = playerHandle ? nameByHandle[playerHandle] ?? playerHandle : "Empty slot";
    const avatar = playerHandle ? avatarByHandle[playerHandle] : null;

    const task = p ? tasksByKey[taskKey(playerHandle, tf, i)] : null;
    const title = task?.title ?? (empty ? "Draft a friend’s goal here" : `${tf} goal ${i + 1}`);
    const done = !!task?.done_at;

    return (
      <div className={["rounded-2xl border p-3 shadow-sm", empty ? "border-slate-200 bg-white/70" : "border-slate-200 bg-white/90"].join(" ")}>
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-600">{label}</div>

          {!empty && (
            <div className={["rounded-xl border px-3 py-1 text-xs font-bold", done ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-700"].join(" ")}>
              {done ? `✓ +${POINTS[tf]} pts` : "Not done"}
            </div>
          )}
        </div>

        <div className="mt-2 flex items-center gap-3">
          <Avatar src={avatar} alt={playerName} size={34} />
          <div className="min-w-0">
            <div className="text-sm font-bold text-slate-900">{playerName}</div>
            <div className="text-xs text-slate-500">{empty ? "No player drafted" : `Player: ${playerHandle}`}</div>
          </div>
        </div>

        <div className={["mt-3 rounded-xl border px-3 py-2 text-sm font-semibold", done ? "border-emerald-200 bg-emerald-50/40 text-slate-700" : "border-slate-200 bg-white text-slate-900"].join(" ")}>
          {title}
        </div>
      </div>
    );
  };

  const historyByWeek = useMemo(() => {
    const groups: Record<string, TeamHistoryRow[]> = {};
    for (const r of teamHistory) {
      const d = new Date(r.completed_at);
      const wkStart = isoWeekStart(d);
      const key = wkStart.toISOString().slice(0, 10);
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    }
    const keys = Object.keys(groups).sort((a, b) => (a < b ? 1 : -1));
    return { groups, keys };
  }, [teamHistory]);

  const TeamStatsPanel = () => (
    <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200">
      <div className="bg-slate-50 px-4 py-3">
        <div className="text-sm font-bold text-slate-900">Slot stat lines</div>
        <div className="text-xs text-slate-600">Points are total points earned YTD for that slot. Rate is based on time elapsed this year.</div>
      </div>

      <table className="w-full text-left text-sm">
        <thead className="bg-white text-xs font-bold uppercase text-slate-600">
          <tr className="border-t border-slate-200">
            <th className="px-4 py-3">Slot</th>
            <th className="px-4 py-3">Player</th>
            <th className="px-4 py-3">Goal</th>
            <th className="px-4 py-3">Points</th>
            <th className="px-4 py-3">Rate</th>
          </tr>
        </thead>

        <tbody className="divide-y divide-slate-200 bg-white">
          {slotStats.map((s) => {
            const pct = Math.round(s.completionRate * 100);
            const isEmpty = !s.playerHandle;

            return (
              <tr key={`${s.timeframe}-${s.slot_index}`} className={isEmpty ? "opacity-70" : ""}>
                <td className="px-4 py-3">
                  <div className="font-semibold text-slate-900">{s.label}</div>
                  <div className="text-xs text-slate-500">{s.timeframe}</div>
                </td>

                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Avatar src={s.playerAvatar} alt={s.playerName} size={26} />
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900">{s.playerName}</div>
                      <div className="text-xs text-slate-500">{s.playerHandle ?? "—"}</div>
                    </div>
                  </div>
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
              <td className="px-4 py-4 text-slate-600" colSpan={5}>
                No drafted slots yet (or no history).
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  const TeamYtdAndHistory = () => (
    <div className="mt-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-lg font-bold text-slate-900">Team Year-to-date</div>
          <div className="text-xs text-slate-600">Counts only completion events that match your drafted slots.</div>
        </div>
        <div className="text-sm font-bold text-slate-900">
          YTD points: <span className="text-emerald-700">{teamYtd.totalPoints}</span>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
          <div className="text-xs font-bold text-sky-900">Weekly events</div>
          <div className="mt-1 text-3xl font-black text-sky-900">{teamYtd.weekly}</div>
        </div>
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
          <div className="text-xs font-bold text-indigo-900">Monthly events</div>
          <div className="mt-1 text-3xl font-black text-indigo-900">{teamYtd.monthly}</div>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="text-xs font-bold text-emerald-900">Yearly events</div>
          <div className="mt-1 text-3xl font-black text-emerald-900">{teamYtd.yearly}</div>
        </div>
      </div>

      {/* simplified stat lines */}
      <TeamStatsPanel />

      <div className="mt-8">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-bold text-slate-900">History (by week)</div>
          <div className="text-xs text-slate-500">Showing up to {teamHistory.length} events</div>
        </div>

        <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs font-bold uppercase text-slate-600">
              <tr>
                <th className="px-4 py-3">Week</th>
                <th className="px-4 py-3">Player</th>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Goal</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Pts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {historyByWeek.keys.length === 0 ? (
                <tr>
                  <td className="px-4 py-4 text-slate-600" colSpan={6}>
                    No team completions logged yet this year.
                  </td>
                </tr>
              ) : (
                historyByWeek.keys.flatMap((wkKey) => {
                  const wkStart = new Date(wkKey);
                  const wkEnd = addDays(wkStart, 6);
                  const wkNum = isoWeekNumber(wkStart);

                  return historyByWeek.groups[wkKey]
                    .sort((a, b) => (a.completed_at < b.completed_at ? 1 : -1))
                    .map((r, idx) => (
                      <tr key={`${wkKey}-${r.id}`}>
                        <td className="px-4 py-3 text-slate-700">
                          {idx === 0 ? (
                            <div className="font-semibold">
                              W{wkNum}{" "}
                              <span className="text-slate-500">
                                ({fmtShort(wkStart)}–{fmtShort(wkEnd)})
                              </span>
                            </div>
                          ) : (
                            ""
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Avatar src={r.playerAvatar} alt={r.playerName} size={26} />
                            <span className="font-semibold text-slate-900">{r.playerName}</span>
                          </div>
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
                          <span className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-bold text-slate-700">
                            {r.timeframe}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-bold text-emerald-700">+{r.pts}</td>
                      </tr>
                    ));
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
            <h1 className="text-3xl font-bold tracking-tight">My Team</h1>
            <p className="mt-1 text-sm text-slate-600">Soccer-style lineup of your drafted goals.</p>
          </div>

          <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <div className="text-right">
              <div className="text-xs font-semibold text-slate-600">Manager</div>
              <div className="text-sm font-bold text-slate-900">{managerName}</div>
            </div>
            <Avatar src={avatarByHandle[activeUser]} alt={managerName} size={36} />
            <div className="ml-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">
              {totalPointsNow} pts (current)
            </div>
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

        {/* Formation */}
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
                  <SlotCard tf="weekly" i={0} label="Weekly 1" />
                  <SlotCard tf="weekly" i={1} label="Weekly 2" />
                  <SlotCard tf="weekly" i={2} label="Weekly 3" />
                </div>

                <div className="mx-auto grid w-full max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
                  <SlotCard tf="monthly" i={0} label="Monthly 1" />
                  <SlotCard tf="monthly" i={1} label="Monthly 2" />
                </div>

                <div className="mx-auto grid w-full max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
                  <SlotCard tf="yearly" i={0} label="Yearly 1" />
                  <SlotCard tf="yearly" i={1} label="Yearly 2" />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* YTD + simplified stats + history */}
        <TeamYtdAndHistory />
      </div>
    </main>
  );
}
