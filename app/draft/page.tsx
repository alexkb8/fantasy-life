"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";

type Timeframe = "weekly" | "monthly" | "yearly";
const LEAGUE_ID = "default";
const ACTIVE_USER_KEY = "fantasy-life:activeUser";

const SLOT_COUNTS: Record<Timeframe, number> = { weekly: 3, monthly: 2, yearly: 2 };
const PICKS_PER_MANAGER = 7;

type DraftState = {
  league_id: string;
  status: "not_started" | "active" | "done";
  pick_number: number;
  pick_deadline: string | null;
};

type LeagueMember = { league_id: string; user_id: string };

type TaskRow = {
  user_id: string;
  timeframe: Timeframe;
  slot_index: number;
  title: string;
  done_at: string | null;
};

type DraftPick = {
  league_id: string;
  pick_number: number;
  manager_id: string;
  drafted_user_id: string;
  timeframe: Timeframe;
  slot_index: number;
  created_at: string;
};

function getActiveUser(): string {
  if (typeof window === "undefined") return "alex";
  return localStorage.getItem(ACTIVE_USER_KEY) || "alex";
}

function snakeManager(membersAsc: string[], pickNumber: number) {
  const n = membersAsc.length;
  if (n === 0) return null;
  const round = Math.floor(pickNumber / n);
  const within = pickNumber % n;
  return round % 2 === 0 ? membersAsc[within] : [...membersAsc].reverse()[within];
}

function msUntil(deadlineIso: string | null) {
  if (!deadlineIso) return 0;
  return Math.max(0, new Date(deadlineIso).getTime() - Date.now());
}
function fmtSeconds(ms: number) {
  return Math.ceil(ms / 1000);
}

function tfLabel(tf: Timeframe) {
  if (tf === "weekly") return "Weekly";
  if (tf === "monthly") return "Monthly";
  return "Yearly";
}

function taskKey(t: TaskRow) {
  return `${t.user_id}|${t.timeframe}|${t.slot_index}`;
}
function dpKey(p: DraftPick) {
  return `${p.drafted_user_id}|${p.timeframe}|${p.slot_index}`;
}

function lookupGoalTitle(tasks: TaskRow[], draftedUserId: string, tf: Timeframe, slotIndex: number) {
  const match = tasks.find((t) => t.user_id === draftedUserId && t.timeframe === tf && t.slot_index === slotIndex);
  return match?.title ?? `(goal slot ${slotIndex + 1})`;
}

function theme(tf: Timeframe) {
  if (tf === "weekly") {
    return {
      badge: "border-sky-200 bg-sky-50 text-sky-900",
      panel: "border-sky-200 bg-sky-50/60",
      dot: "bg-sky-600",
      ringBase: "ring-2 ring-sky-200", // constant thickness
      ringHover: "hover:ring-sky-300", // only color changes
      btn: "border-sky-200 bg-sky-50 text-sky-900 hover:bg-sky-100",
    };
  }
  if (tf === "monthly") {
    return {
      badge: "border-indigo-200 bg-indigo-50 text-indigo-900",
      panel: "border-indigo-200 bg-indigo-50/60",
      dot: "bg-indigo-600",
      ringBase: "ring-2 ring-indigo-200",
      ringHover: "hover:ring-indigo-300",
      btn: "border-indigo-200 bg-indigo-50 text-indigo-900 hover:bg-indigo-100",
    };
  }
  return {
    badge: "border-emerald-200 bg-emerald-50 text-emerald-900",
    panel: "border-emerald-200 bg-emerald-50/60",
    dot: "bg-emerald-600",
    ringBase: "ring-2 ring-emerald-200",
    ringHover: "hover:ring-emerald-300",
    btn: "border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100",
  };
}

export default function DraftPage() {
  const [activeUser, setActiveUser] = useState("alex");

  const [members, setMembers] = useState<string[]>([]);
  const [state, setState] = useState<DraftState | null>(null);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [picks, setPicks] = useState<DraftPick[]>([]);

  const [err, setErr] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [pending, setPending] = useState<null | "start" | "autopick" | "pick">(null);

  // local countdown tick (kept, but stable scroll restoration handles rerenders)
  const [nowTick, setNowTick] = useState<number>(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 500); // slightly slower -> fewer rerenders
    return () => clearInterval(id);
  }, []);

  const subsRef = useRef<any[]>([]);

  // Draft order scroll persistence
  const draftOrderScrollEl = useRef<HTMLDivElement | null>(null);
  const draftOrderScrollTop = useRef<number>(0);

  useEffect(() => {
    setActiveUser(getActiveUser());
    const onChange = () => setActiveUser(getActiveUser());
    window.addEventListener("fantasy-life:activeUserChanged", onChange);
    return () => window.removeEventListener("fantasy-life:activeUserChanged", onChange);
  }, []);

  // ---- Fetch helpers ----
  const fetchMembers = async () => {
    const res = await supabase.from("league_members").select("league_id,user_id").eq("league_id", LEAGUE_ID);
    if (res.error) throw res.error;
    const ids = ((res.data ?? []) as LeagueMember[]).map((x) => x.user_id).sort();
    setMembers(ids);
  };

  const fetchState = async () => {
    const res = await supabase
      .from("draft_state")
      .select("league_id,status,pick_number,pick_deadline")
      .eq("league_id", LEAGUE_ID)
      .single();
    if (res.error) throw res.error;
    setState((res.data as DraftState) ?? null);
  };

  const fetchTasks = async () => {
    const res = await supabase.from("tasks").select("user_id,timeframe,slot_index,title,done_at");
    if (res.error) throw res.error;
    setTasks((res.data ?? []) as TaskRow[]);
  };

  const fetchPicks = async () => {
    const res = await supabase
      .from("draft_picks")
      .select("league_id,pick_number,manager_id,drafted_user_id,timeframe,slot_index,created_at")
      .eq("league_id", LEAGUE_ID)
      .order("pick_number", { ascending: true });
    if (res.error) throw res.error;
    setPicks((res.data ?? []) as DraftPick[]);
  };

  const bootstrap = async () => {
    setErr("");
    setStatusMsg("");
    try {
      await Promise.all([fetchMembers(), fetchState(), fetchTasks(), fetchPicks()]);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  };

  // ---- Realtime subscriptions (no polling) ----
  useEffect(() => {
    let cancelled = false;

    const setupRealtime = async () => {
      for (const ch of subsRef.current) {
        try {
          await supabase.removeChannel(ch);
        } catch {}
      }
      subsRef.current = [];

      await bootstrap();
      if (cancelled) return;

      const chState = supabase
        .channel("fantasy-life:draft_state")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "draft_state", filter: `league_id=eq.${LEAGUE_ID}` },
          () => fetchState().catch((e: any) => setErr(String(e?.message ?? e)))
        )
        .subscribe();

      const chPicks = supabase
        .channel("fantasy-life:draft_picks")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "draft_picks", filter: `league_id=eq.${LEAGUE_ID}` },
          () => fetchPicks().catch((e: any) => setErr(String(e?.message ?? e)))
        )
        .subscribe();

      const chTasks = supabase
        .channel("fantasy-life:tasks")
        .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () =>
          fetchTasks().catch((e: any) => setErr(String(e?.message ?? e)))
        )
        .subscribe();

      const chMembers = supabase
        .channel("fantasy-life:league_members")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "league_members", filter: `league_id=eq.${LEAGUE_ID}` },
          () => fetchMembers().catch((e: any) => setErr(String(e?.message ?? e)))
        )
        .subscribe();

      subsRef.current = [chState, chPicks, chTasks, chMembers];
    };

    setupRealtime();

    return () => {
      cancelled = true;
      (async () => {
        for (const ch of subsRef.current) {
          try {
            await supabase.removeChannel(ch);
          } catch {}
        }
        subsRef.current = [];
      })();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restore draft order scroll position after rerenders that change rows
  useEffect(() => {
    const el = draftOrderScrollEl.current;
    if (!el) return;
    const desired = draftOrderScrollTop.current;

    // wait for DOM paint before restoring
    requestAnimationFrame(() => {
      if (draftOrderScrollEl.current) {
        draftOrderScrollEl.current.scrollTop = desired;
      }
    });
  }, [picks.length, members.length, state?.pick_number, state?.status, nowTick]);

  // ---- Derived ----
  const totalPicks = useMemo(() => members.length * PICKS_PER_MANAGER, [members.length]);

  const currentManager = useMemo(() => {
    if (!state) return null;
    return snakeManager(members, state.pick_number);
  }, [members, state]);

  const timeLeftMs = useMemo(() => msUntil(state?.pick_deadline ?? null), [state, nowTick]);
  const timeLeftSec = useMemo(() => fmtSeconds(timeLeftMs), [timeLeftMs]);

  const draftedSet = useMemo(() => {
    const s = new Set<string>();
    for (const dp of picks) s.add(dpKey(dp));
    return s;
  }, [picks]);

  const picksByNumber = useMemo(() => {
    const m = new Map<number, DraftPick>();
    for (const p of picks) m.set(p.pick_number, p);
    return m;
  }, [picks]);

  const boardByTf = useMemo(() => {
    const memberSet = new Set(members);
    const eligible = tasks.filter((t) => memberSet.has(t.user_id));
    const groups: Record<Timeframe, TaskRow[]> = { weekly: [], monthly: [], yearly: [] };
    for (const t of eligible) groups[t.timeframe].push(t);

    (Object.keys(groups) as Timeframe[]).forEach((tf) => {
      groups[tf].sort((a, b) => (a.user_id !== b.user_id ? a.user_id.localeCompare(b.user_id) : a.slot_index - b.slot_index));
    });

    return groups;
  }, [tasks, members]);

  const myRoster = useMemo(() => {
    const mine = picks.filter((p) => p.manager_id === activeUser).sort((a, b) => a.pick_number - b.pick_number);

    const roster: {
      timeframe: Timeframe;
      roster_slot_index: number;
      filled: boolean;
      player_id: string | null;
      goal_title: string | null;
    }[] = [];

    (["weekly", "monthly", "yearly"] as Timeframe[]).forEach((tf) => {
      for (let i = 0; i < SLOT_COUNTS[tf]; i++) {
        roster.push({ timeframe: tf, roster_slot_index: i, filled: false, player_id: null, goal_title: null });
      }
    });

    const nextEmpty = (tf: Timeframe) => roster.find((r) => r.timeframe === tf && !r.filled) ?? null;

    for (const p of mine) {
      const slot = nextEmpty(p.timeframe);
      if (!slot) continue;
      slot.filled = true;
      slot.player_id = p.drafted_user_id;
      slot.goal_title = lookupGoalTitle(tasks, p.drafted_user_id, p.timeframe, p.slot_index);
    }

    return roster;
  }, [picks, activeUser, tasks]);

  const remainingSlots = useMemo(() => {
    const rem: Record<Timeframe, number> = { weekly: 0, monthly: 0, yearly: 0 };
    for (const r of myRoster) if (!r.filled) rem[r.timeframe] += 1;
    return rem;
  }, [myRoster]);

  const statusLine = useMemo(() => {
    if (!state) return "Loading…";
    if (state.status !== "active") return `Draft is ${state.status}. Click Start.`;
    if (pending) return "Working…";
    if (currentManager !== activeUser) return `Not your turn. On the clock: ${currentManager ?? "—"}`;
    return "Your turn — pick a goal.";
  }, [state, pending, currentManager, activeUser]);

  // ---- RPC calls ----
  const callRpc = async (label: typeof pending, fn: () => Promise<{ error: any }>, okMsg: string) => {
    setErr("");
    setStatusMsg("");
    setPending(label);
    try {
      const { error } = await fn();
      if (error) {
        setErr(String(error.message ?? error));
      } else {
        setStatusMsg(okMsg);
        await Promise.all([fetchState(), fetchPicks()]);
      }
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setPending(null);
    }
  };

  const onStart = () =>
    callRpc("start", () => supabase.rpc("draft_start", { p_league_id: LEAGUE_ID }) as any, "Draft started / restarted.");

  const onAutopick = () =>
    callRpc("autopick", () => supabase.rpc("draft_autopick", { p_league_id: LEAGUE_ID }) as any, "Autopick executed.");

  const pickTask = async (t: TaskRow) => {
    setErr("");
    setStatusMsg("");

    if (draftedSet.has(taskKey(t))) {
      setStatusMsg("That goal is already drafted.");
      return;
    }
    if (!state) {
      setStatusMsg("Still loading — try again in a sec.");
      return;
    }
    if (state.status !== "active") {
      setStatusMsg(`Draft is ${state.status}. Click Start.`);
      return;
    }
    if (pending) return;

    if (currentManager !== activeUser) {
      setStatusMsg(`Not your turn — on the clock: ${currentManager ?? "—"}. (Switch user in Nav to test.)`);
      return;
    }

    await callRpc(
      "pick",
      () =>
        supabase.rpc("draft_make_pick", {
          p_league_id: LEAGUE_ID,
          p_drafted_user_id: t.user_id,
          p_timeframe: t.timeframe,
          p_slot_index: t.slot_index,
        }) as any,
      `Picked: ${t.user_id} ${t.timeframe} goal ${t.slot_index + 1}`
    );
  };

  // ---- UI components ----
  function DraftSection({ tf, items }: { tf: Timeframe; items: TaskRow[] }) {
    const th = theme(tf);

    return (
      <div className={"rounded-3xl border p-4 " + th.panel}>
        <div className="flex items-center justify-between">
          <div className="text-lg font-black text-slate-900">{tfLabel(tf)}</div>
          <span className={"rounded-xl border px-3 py-1 text-xs font-bold " + th.badge}>
            {items.length}
          </span>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {items.map((t) => {
            const drafted = draftedSet.has(taskKey(t));
            const disablePick = drafted || pending !== null;

            // FIXED: constant ring thickness; only shadow changes on hover -> no flicker
            const cardClass =
              "rounded-2xl border p-4 transition " +
              (drafted
                ? "border-slate-200 bg-white/40 opacity-60"
                : "border-slate-200 bg-white ring-2 " +
                  th.ringBase +
                  " " +
                  th.ringHover +
                  " hover:shadow-md");

            return (
              <div key={taskKey(t)} className={cardClass}>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-black text-slate-900">
                    {t.user_id} — Goal {t.slot_index + 1}
                  </div>
                  <span className={"rounded-lg border px-2 py-1 text-xs font-bold " + th.badge}>
                    {t.timeframe}
                  </span>
                </div>

                <div className="mt-2 text-sm font-semibold text-slate-800">{t.title}</div>

                <div className="mt-4 flex items-center justify-between gap-3">
                  <div className="text-xs text-slate-500">{drafted ? "Drafted" : "Available"}</div>

                  <button
                    type="button"
                    onClick={() => pickTask(t)}
                    disabled={disablePick}
                    className={
                      "rounded-xl border px-3 py-2 text-sm font-black shadow-sm " +
                      (disablePick
                        ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-500"
                        : th.btn)
                    }
                  >
                    {drafted ? "Picked" : pending === "pick" ? "Picking…" : "Pick"}
                  </button>
                </div>
              </div>
            );
          })}

          {items.length === 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white/60 p-4 text-sm text-slate-600">
              No goals found for this category.
            </div>
          )}
        </div>
      </div>
    );
  }

  function DraftOrderCompact() {
    if (members.length === 0) return null;

    const rows: { i: number; manager: string; p: DraftPick | null; isCurrent: boolean }[] = [];
    for (let i = 0; i < totalPicks; i++) {
      const manager = snakeManager(members, i);
      const p = picksByNumber.get(i) || null;
      const isCurrent = state?.status === "active" && state.pick_number === i;
      rows.push({ i, manager: manager ?? "—", p, isCurrent });
    }

    return (
      <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="sticky top-0 z-10 bg-slate-50 px-4 py-3">
          <div className="text-sm font-bold text-slate-900">Draft Order</div>
          <div className="text-xs text-slate-600">Scroll to see all picks</div>
        </div>

        {/* FIXED: stable fixed height + scrollTop persistence */}
        <div
          ref={draftOrderScrollEl}
          onScroll={(e) => {
            draftOrderScrollTop.current = (e.currentTarget as HTMLDivElement).scrollTop;
          }}
          className="h-[460px] overflow-auto"
        >
          <table className="w-full text-left text-xs">
            <thead className="border-t border-slate-200 bg-white font-bold uppercase text-slate-600">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Mgr</th>
                <th className="px-3 py-2">Pick</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rows.map((r) => (
                <tr key={r.i} className={r.isCurrent ? "bg-amber-50/60" : ""}>
                  <td className="px-3 py-2 font-semibold text-slate-700">{r.i + 1}</td>
                  <td className="px-3 py-2 font-semibold text-slate-900">{r.manager}</td>
                  <td className="px-3 py-2 text-slate-700">
                    {r.p ? (
                      <>
                        <span className="font-bold">{r.p.drafted_user_id}</span>{" "}
                        <span className="text-slate-500">
                          ({r.p.timeframe} #{r.p.slot_index + 1})
                        </span>
                      </>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function Sidebar() {
    const rosterWeekly = myRoster.filter((r) => r.timeframe === "weekly");
    const rosterMonthly = myRoster.filter((r) => r.timeframe === "monthly");
    const rosterYearly = myRoster.filter((r) => r.timeframe === "yearly");

    const RosterBlock = ({
      tf,
      rows,
    }: {
      tf: Timeframe;
      rows: { timeframe: Timeframe; roster_slot_index: number; filled: boolean; player_id: string | null; goal_title: string | null }[];
    }) => {
      const th = theme(tf);
      return (
        <div className={"rounded-2xl border p-3 " + th.panel}>
          <div className="flex items-center justify-between">
            <div className="text-sm font-black text-slate-900">{tfLabel(tf)}</div>
            <span className={"rounded-lg border px-2 py-1 text-xs font-bold " + th.badge}>
              {SLOT_COUNTS[tf]}
            </span>
          </div>

          <div className="mt-2 grid gap-2">
            {rows.map((s) => (
              <div
                key={tf + ":" + s.roster_slot_index}
                className={"rounded-xl border px-3 py-2 " + (s.filled ? "border-slate-200 bg-white" : "border-slate-200 bg-white/60")}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold">
                    <div className={"h-2.5 w-2.5 rounded-full " + (s.filled ? th.dot : "bg-slate-300")} />
                    <span className={s.filled ? "text-slate-900" : "text-slate-500"}>
                      {tfLabel(tf)} {s.roster_slot_index + 1}
                    </span>
                  </div>
                  <div className="truncate text-right text-xs font-black text-slate-900">
                    {s.filled ? s.player_id : "OPEN"}
                  </div>
                </div>
                <div className="mt-1 line-clamp-2 text-[11px] text-slate-600">
                  {s.filled ? s.goal_title : "Pick a goal in this category."}
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    };

    return (
      <div className="sticky top-6 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-bold uppercase text-slate-600">My roster</div>
            <div className="text-lg font-black text-slate-900">{activeUser}</div>
            <div className="mt-1 text-xs text-slate-600">
              Remaining:{" "}
              <span className="font-bold text-sky-700">{remainingSlots.weekly}W</span>{" "}
              <span className="font-bold text-indigo-700">{remainingSlots.monthly}M</span>{" "}
              <span className="font-bold text-emerald-700">{remainingSlots.yearly}Y</span>
            </div>
          </div>

          <div className="text-right">
            <div className="text-xs font-bold uppercase text-slate-600">On the clock</div>
            <div className="text-base font-black text-slate-900">{currentManager ?? "—"}</div>
            <div
              className={
                "mt-1 inline-flex items-center rounded-xl border px-3 py-1 text-xs font-bold " +
                (state?.status === "active"
                  ? "border-amber-200 bg-amber-50 text-amber-900"
                  : "border-slate-200 bg-slate-50 text-slate-700")
              }
            >
              {state?.status === "active" ? `Pick #${(state.pick_number ?? 0) + 1} · ${timeLeftSec}s` : state?.status ?? "—"}
            </div>
          </div>
        </div>

        <div className="mt-4">
          <div className="text-xs font-bold uppercase text-slate-600">Current roster</div>
          <div className="mt-2 grid gap-3">
            <RosterBlock tf="weekly" rows={rosterWeekly} />
            <RosterBlock tf="monthly" rows={rosterMonthly} />
            <RosterBlock tf="yearly" rows={rosterYearly} />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onStart}
            disabled={pending !== null}
            className={
              "rounded-xl border px-3 py-2 text-sm font-bold shadow-sm " +
              (pending === "start"
                ? "border-slate-200 bg-slate-100 text-slate-700"
                : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50") +
              (pending ? " cursor-not-allowed" : "")
            }
          >
            {pending === "start" ? "Starting…" : state?.status === "active" ? "Restart" : "Start"}
          </button>

          <button
            type="button"
            onClick={onAutopick}
            disabled={pending !== null || state?.status !== "active"}
            className={
              "rounded-xl border px-3 py-2 text-sm font-bold shadow-sm " +
              (pending === "autopick"
                ? "border-amber-200 bg-amber-100 text-amber-900"
                : "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100") +
              (pending !== null || state?.status !== "active" ? " cursor-not-allowed opacity-70" : "")
            }
          >
            {pending === "autopick" ? "Picking…" : "Autopick"}
          </button>
        </div>

        {/* ✅ Under My roster */}
        <DraftOrderCompact />
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-6xl px-5 py-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Draft</h1>
            <p className="mt-1 text-sm text-slate-600">
              Snake draft · {members.length || 0} managers · {PICKS_PER_MANAGER} picks each
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3 text-sm text-slate-700">
          <span className="font-bold">Status:</span> {statusLine}
        </div>

        {err && (
          <div className="mt-4 rounded-2xl border border-red-200 bg-white p-4 text-sm text-red-700">
            <div className="font-bold">Error</div>
            <div className="mt-1 whitespace-pre-wrap">{err}</div>
          </div>
        )}

        {!err && statusMsg && (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-white p-3 text-sm text-emerald-700">
            {statusMsg}
          </div>
        )}

        <div className="mt-6 grid items-start gap-6 lg:grid-cols-[360px_1fr]">
          <div className="-ml-1 lg:-ml-10">
            <Sidebar />
          </div>

          <div>
            <div className="px-1">
              <h2 className="text-2xl font-black text-slate-900">Draft Board</h2>
            </div>

            <div className="mt-3 space-y-4">
              <DraftSection tf="weekly" items={boardByTf.weekly} />
              <DraftSection tf="monthly" items={boardByTf.monthly} />
              <DraftSection tf="yearly" items={boardByTf.yearly} />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}