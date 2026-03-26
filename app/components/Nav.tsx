"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import Avatar from "./Avatar";

type ProfileRow = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  active_league_id: string | null;
};

export default function Nav() {
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [name, setName] = useState("Player");
  const [avatar, setAvatar] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);

    const { data } = await supabase.auth.getUser();
    const user = data.user;

    if (!user) {
      setSignedIn(false);
      setName("Player");
      setAvatar(null);
      setLoading(false);
      return;
    }

    setSignedIn(true);

    const profRes = await supabase
      .from("profiles")
      .select("id, display_name, avatar_url, active_league_id")
      .eq("id", user.id)
      .single();

    if (!profRes.error && profRes.data) {
      const p = profRes.data as ProfileRow;
      setName(p.display_name || "Player");
      setAvatar(p.avatar_url || null);
    }

    setLoading(false);
  };

  useEffect(() => {
    refresh();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      refresh();
    });

    return () => subscription.unsubscribe();
  }, []);

  const logout = async () => {
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  return (
    <nav className="w-full border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-3">
        <div className="flex flex-wrap items-center gap-4">
          <Link href="/" className="font-black text-slate-900">
            fantasy-life
          </Link>

          <Link href="/tasks" className="text-sm font-semibold text-slate-700 hover:text-slate-900">
            My Tasks
          </Link>
          <Link href="/team" className="text-sm font-semibold text-slate-700 hover:text-slate-900">
            My Team
          </Link>
          <Link href="/draft" className="text-sm font-semibold text-slate-700 hover:text-slate-900">
            Draft
          </Link>
          <Link href="/feed" className="text-sm font-semibold text-slate-700 hover:text-slate-900">
            Feed
          </Link>
          <Link href="/join" className="text-sm font-semibold text-slate-700 hover:text-slate-900">
            Join
          </Link>
          <Link href="/profile" className="text-sm font-semibold text-slate-700 hover:text-slate-900">
            Profile
          </Link>
        </div>

        <div className="flex items-center gap-3">
          {loading ? (
            <div className="text-sm text-slate-500">Loading...</div>
          ) : !signedIn ? (
            <Link
              href="/login"
              className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-black text-white"
            >
              Log in
            </Link>
          ) : (
            <>
              <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
                <Avatar src={avatar} alt={name} size={32} />
                <div className="text-sm font-black text-slate-900">{name}</div>
              </div>
              <button
                type="button"
                onClick={logout}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-900"
              >
                Log out
              </button>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}