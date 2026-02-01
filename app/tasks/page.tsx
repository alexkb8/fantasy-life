"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import Avatar from "../components/Avatar";

type Timeframe = "weekly" | "monthly" | "yearly";
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

function slotKey(tf: Timeframe, i: number) {
  return `${tf}:${i}`;
}

/** ---- Time helpers (ISO week + week range + month range) ---- */
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
  // Move to Thursday of this week
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

export default function TasksPage() {
  const [activeUser, setActiveUser] = useState<UserId>("alex");
  const [tasks, setTasks] = useState<Record<string, TaskRow>>({});
  const [nameByHandle, setNameByHandle] = useState<Record<string, string>>({});
  const [avatarByHandle, setAvatarByHandle] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string>("");

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

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    return {
      today: fmtLong(now),
      weekLabel: `Week ${wkNum}`,
      weekRange: `${fmtShort(wkStart)} – ${fmtShort(wkEnd)}`,
      weekEndsIn: daysLeftInclusive(wkEnd),
      monthLabel: now.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
      monthRange: `${fmtShort(monthStart)} – ${fmtShort(monthEnd)}`,
      monthEndsIn: daysLeftInclusive(monthEnd),
    };
  }, []);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setMsg("");

      // Load profiles map (handle -> name/avatar)
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

      // Load tasks for active user
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

      // Ensure slots exist client-side (so layout always shows)
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
      setLoading(false);
    };

    load();
  }, [activeUser]);

  const saveTaskTitle = async (tf: Timeframe, i: number, title: string) => {
    const k = slotKey(tf, i);
    const cur = tasks[k];
    const next: TaskRow = { ...cur, title };

    // optimistic update
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
    const newDoneAt = cur.done_at ? null : new Date().toISOString();

    // optimistic update
    setTasks((prev) => ({ ...prev, [k]: { ...cur, done_at: newDoneAt } }));

    const { error } = await supabase
      .from("tasks")
      .upsert(
        { user_id: activeUser, timeframe: tf, slot_index: i, title: cur.title, done_at: newDoneAt },
        { onConflict: "user_id,timeframe,slot_index" }
      );

    if (error) {
      // revert
      setTasks((prev) => ({ ...prev, [k]: cur }));
      setMsg(error.message);
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
          done
            ? "border-emerald-200 bg-emerald-50/60"
            : "border-slate-200 bg-white/90 hover:bg-slate-50",
        ].join(" ")}
        title="Click to toggle complete"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-600">{label}</div>

          {/* big checkbox */}
          <div
            className={[
              "flex h-9 w-9 items-center justify-center rounded-xl border text-lg font-black transition",
              done
                ? "border-emerald-300 bg-emerald-600 text-white"
                : "border-slate-300 bg-white text-slate-300",
            ].join(" ")}
            aria-label={done ? "Completed" : "Not completed"}
          >
            {done ? "✓" : ""}
          </div>
        </div>

        {/* Title input (clicking inside should NOT toggle done) */}
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
                {/* Weekly row */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <CheckCard tf="weekly" i={0} label="Weekly 1" />
                  <CheckCard tf="weekly" i={1} label="Weekly 2" />
                  <CheckCard tf="weekly" i={2} label="Weekly 3" />
                </div>

                {/* Monthly row */}
                <div className="mx-auto grid w-full max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
                  <CheckCard tf="monthly" i={0} label="Monthly 1" />
                  <CheckCard tf="monthly" i={1} label="Monthly 2" />
                </div>

                {/* Yearly row */}
                <div className="mx-auto grid w-full max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
                  <CheckCard tf="yearly" i={0} label="Yearly 1" />
                  <CheckCard tf="yearly" i={1} label="Yearly 2" />
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
