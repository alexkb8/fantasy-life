"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import Avatar from "../components/Avatar";

type Timeframe = "weekly" | "monthly" | "yearly";
const POINTS: Record<Timeframe, number> = { weekly: 1, monthly: 4, yearly: 40 };
const SLOT_COUNTS: Record<Timeframe, number> = { weekly: 3, monthly: 2, yearly: 2 };

type PickRow = {
  manager_id: string; // handle
  timeframe: Timeframe;
  slot_index: number;
  player_id: string; // handle
};

type TaskRow = {
  user_id: string; // handle
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

/** ---- Time helpers ---- */
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
  return date; // Monday
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

export default function TeamPage() {
  const [activeUser, setActiveUser] = useState<UserId>("alex");

  const [nameByHandle, setNameByHandle] = useState<Record<string, string>>({});
  const [avatarByHandle, setAvatarByHandle] = useState<Record<string, string>>({});

  const [picksBySlot, setPicksBySlot] = useState<Record<string, PickRow | null>>({});
  const [tasksByKey, setTasksByKey] = useState<Record<string, TaskRow>>({});

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string>("");

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

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
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

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setMsg("");

      // 1) Profiles by handle (for avatars/names)
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

      // 2) Picks for this manager
      const pRes = await supabase
        .from("team_picks")
        .select("manager_id,timeframe,slot_index,player_id")
        .eq("manager_id", activeUser);

      if (pRes.error) {
        setMsg(pRes.error.message);
        setLoading(false);
        return;
      }

      const picks = (pRes.data ?? []) as PickRow[];
      const bySlot: Record<string, PickRow | null> = {};

      (["weekly", "monthly", "yearly"] as Timeframe[]).forEach((tf) => {
        for (let i = 0; i < SLOT_COUNTS[tf]; i++) bySlot[pickKey(tf, i)] = null;
      });
      for (const p of picks) bySlot[pickKey(p.timeframe, p.slot_index)] = p;
      setPicksBySlot(bySlot);

      // 3) Load tasks for drafted players
      const draftedPlayers = Array.from(new Set(picks.map((p) => p.player_id)));
      if (draftedPlayers.length === 0) {
        setTasksByKey({});
        setLoading(false);
        return;
      }

      const tRes = await supabase
        .from("tasks")
        .select("user_id,timeframe,slot_index,title,done_at")
        .in("user_id", draftedPlayers);

      if (tRes.error) {
        setMsg(tRes.error.message);
        setLoading(false);
        return;
      }

      const tmap: Record<string, TaskRow> = {};
      for (const t of (tRes.data ?? []) as TaskRow[]) {
        tmap[taskKey(t.user_id, t.timeframe, t.slot_index)] = t;
      }
      setTasksByKey(tmap);

      setLoading(false);
    };

    load();
  }, [activeUser]);

  const totalPoints = useMemo(() => {
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
      <div
        className={[
          "rounded-2xl border p-3 shadow-sm",
          empty ? "border-slate-200 bg-white/70" : "border-slate-200 bg-white/90",
        ].join(" ")}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-600">{label}</div>

          {!empty && (
            <div
              className={[
                "rounded-xl border px-3 py-1 text-xs font-bold",
                done
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-slate-200 bg-slate-50 text-slate-700",
              ].join(" ")}
              title={done ? "Completed" : "Not completed"}
            >
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

        <div
          className={[
            "mt-3 rounded-xl border px-3 py-2 text-sm font-semibold",
            done ? "border-emerald-200 bg-emerald-50/40 text-slate-700" : "border-slate-200 bg-white text-slate-900",
          ].join(" ")}
        >
          {title}
        </div>

        {empty && (
          <div className="mt-2 text-xs text-slate-500">
            (Later: add UI to choose which friend/goal occupies this slot.)
          </div>
        )}
      </div>
    );
  };

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
              {totalPoints} pts
            </div>
          </div>
        </div>

        {/* NEW: Week + month banner */}
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
          <div className="mt-4 rounded-2xl border border-red-200 bg-white p-4 text-sm text-red-700">
            {msg}
          </div>
        )}

        <div className="mt-6 rounded-3xl border border-slate-200 bg-gradient-to-b from-emerald-50 to-sky-50 p-5 shadow-sm">
          <div className="relative mx-auto max-w-3xl overflow-hidden rounded-3xl border border-emerald-200 bg-emerald-100/40 p-5">
            {/* field lines */}
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute left-0 right-0 top-1/2 h-[2px] bg-emerald-200/70" />
              <div className="absolute left-1/2 top-1/2 h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-emerald-200/70" />
            </div>

            {loading ? (
              <div className="relative text-sm text-slate-600">Loading…</div>
            ) : (
              <div className="relative grid gap-4">
                {/* Weekly row (3) */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <SlotCard tf="weekly" i={0} label="Weekly 1" />
                  <SlotCard tf="weekly" i={1} label="Weekly 2" />
                  <SlotCard tf="weekly" i={2} label="Weekly 3" />
                </div>

                {/* Monthly row (2) */}
                <div className="mx-auto grid w-full max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
                  <SlotCard tf="monthly" i={0} label="Monthly 1" />
                  <SlotCard tf="monthly" i={1} label="Monthly 2" />
                </div>

                {/* Yearly row (2) */}
                <div className="mx-auto grid w-full max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
                  <SlotCard tf="yearly" i={0} label="Yearly 1" />
                  <SlotCard tf="yearly" i={1} label="Yearly 2" />
                </div>
              </div>
            )}
          </div>

          <div className="mt-3 text-xs text-slate-600">
            Week ends Sunday night. Month ends on the last day of the month.
          </div>
        </div>
      </div>
    </main>
  );
}
