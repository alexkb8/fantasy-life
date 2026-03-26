"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

function makeJoinCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export default function JoinPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  const [leagueName, setLeagueName] = useState("My League");
  const [joinCode, setJoinCode] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const run = async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        router.replace("/login");
        return;
      }

      setUserId(data.user.id);

      const profRes = await supabase
        .from("profiles")
        .select("active_league_id")
        .eq("id", data.user.id)
        .single();

      if (profRes.data?.active_league_id) {
        router.replace("/tasks");
        return;
      }

      setLoading(false);
    };

    run();
  }, [router]);

  const setActiveLeague = async (leagueId: string) => {
    const { error } = await supabase
      .from("profiles")
      .update({ active_league_id: leagueId })
      .eq("id", userId!);

    if (error) throw error;
  };

  const createLeague = async () => {
    setMsg("");

    try {
      const code = makeJoinCode();

      const leagueRes = await supabase
        .from("leagues")
        .insert({
          name: leagueName.trim() || "My League",
          join_code: code,
          created_by: userId!,
        })
        .select("id, join_code")
        .single();

      if (leagueRes.error) throw leagueRes.error;

      const leagueId = leagueRes.data.id as string;

      const memRes = await supabase.from("league_members").insert({
        league_id: leagueId,
        user_id: userId!,
      });
      if (memRes.error) throw memRes.error;

      await setActiveLeague(leagueId);
      router.replace("/tasks");
    } catch (e: any) {
      setMsg(e.message ?? "Failed to create league");
    }
  };

  const joinLeague = async () => {
    setMsg("");

    try {
      const code = joinCode.trim().toUpperCase();
      if (!code) return;

      const leagueRes = await supabase
        .from("leagues")
        .select("id")
        .eq("join_code", code)
        .single();

      if (leagueRes.error) throw leagueRes.error;

      const leagueId = leagueRes.data.id as string;

      const memRes = await supabase.from("league_members").upsert({
        league_id: leagueId,
        user_id: userId!,
      });
      if (memRes.error) throw memRes.error;

      await setActiveLeague(leagueId);
      router.replace("/tasks");
    } catch (e: any) {
      setMsg(e.message ?? "Failed to join league");
    }
  };

  if (loading) return null;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-xl px-5 py-10">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-black">Join a league</h1>
          <p className="mt-1 text-sm text-slate-600">Create a new game or join one with a code.</p>

          <div className="mt-6 grid gap-6">
            <div className="rounded-2xl border border-slate-200 p-4">
              <div className="text-sm font-black">Create new league</div>
              <div className="mt-3 flex gap-2">
                <input
                  className="flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold outline-none"
                  value={leagueName}
                  onChange={(e) => setLeagueName(e.target.value)}
                  placeholder="League name"
                />
                <button
                  type="button"
                  onClick={createLeague}
                  className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white"
                >
                  Create
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 p-4">
              <div className="text-sm font-black">Join existing league</div>
              <div className="mt-3 flex gap-2">
                <input
                  className="flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold uppercase outline-none"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  placeholder="Join code"
                />
                <button
                  type="button"
                  onClick={joinLeague}
                  className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white"
                >
                  Join
                </button>
              </div>
            </div>
          </div>

          {msg && (
            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              {msg}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}