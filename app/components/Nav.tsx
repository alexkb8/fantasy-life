"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";


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

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();

  const [activeUser, setActiveUser] = useState<UserId>("alex");
  const [isAuthed, setIsAuthed] = useState(false);

  useEffect(() => {
    // init user selector
    setActiveUser(getActiveUser());

    // init auth state
    supabase.auth.getSession().then(({ data }) => setIsAuthed(!!data.session));

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthed(!!session);
    });

    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  const onChangeUser = (next: UserId) => {
    setActiveUser(next);
    try {
      localStorage.setItem(ACTIVE_USER_KEY, next);
    } catch {}

    // Notify pages to reload their state
    window.dispatchEvent(new Event("fantasy-life:activeUserChanged"));
  };

  const onLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  const linkClass = (href: string) => {
    const active = pathname === href;
    return [
      "text-sm font-semibold transition",
      active ? "text-slate-900 border-b-2 border-slate-900 pb-1" : "text-slate-600 hover:text-slate-900",
    ].join(" ");
  };

  return (
    <nav className="w-full border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-3">
        <div className="flex items-center gap-4">
          <Link href="/" className="font-bold text-slate-900">
            fantasy-life
          </Link>

          <Link href="/tasks" className={linkClass("/tasks")}>
            My Tasks
          </Link>

          <Link href="/team" className={linkClass("/team")}>
            My Team
          </Link>

          <Link href="/feed" className={linkClass("/feed")}>
            Feed
          </Link>

          <Link href="/profile" className={linkClass("/profile")}>
            Profile
          </Link>
        </div>

        <div className="flex items-center gap-2">
          {/* Keep your MVP user selector for now */}
          <span className="text-sm font-semibold text-slate-600">User</span>
          <select
            value={activeUser}
            onChange={(e) => onChangeUser(e.target.value as UserId)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
          >
            {USERS.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>

          {/* Auth button */}
          {isAuthed ? (
            <button
              onClick={onLogout}
              className="ml-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:text-slate-900"
            >
              Log out
            </button>
          ) : (
            <Link
              href="/login"
              className="ml-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:text-slate-900"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
