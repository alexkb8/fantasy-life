"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

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
  const [activeUser, setActiveUser] = useState<UserId>("alex");

  useEffect(() => {
    // initialize from localStorage
    setActiveUser(getActiveUser());
  }, []);

  const onChangeUser = (next: UserId) => {
    setActiveUser(next);
    try {
      localStorage.setItem(ACTIVE_USER_KEY, next);
    } catch {}

    // Notify pages to reload their state
    window.dispatchEvent(new Event("fantasy-life:activeUserChanged"));
  };

  return (
    <nav className="w-full border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-3">
        <div className="flex items-center gap-4">
          <Link href="/" className="font-bold text-slate-900">
            fantasy-life
          </Link>
          <Link href="/tasks" className="text-sm font-semibold text-slate-700 hover:text-slate-900">
            My Tasks
          </Link>
          <Link href="/team" className="text-sm font-semibold text-slate-700 hover:text-slate-900">
            My Team
          </Link>
        </div>

        <div className="flex items-center gap-2">
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
        </div>
      </div>
    </nav>
  );
}
