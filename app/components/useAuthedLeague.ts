"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useRouter } from "next/navigation";

type ProfileRow = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  active_league_id: string | null;
};

export function useAuthedLeague() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [leagueId, setLeagueId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const run = async () => {
      setLoading(true);

      const { data: authData } = await supabase.auth.getUser();
      const user = authData.user;

      if (!user) {
        router.replace("/login");
        return;
      }

      const profRes = await supabase
        .from("profiles")
        .select("id,display_name,avatar_url,active_league_id")
        .eq("id", user.id)
        .single();

      if (!mounted) return;

      setUserId(user.id);
      setProfile((profRes.data as ProfileRow) ?? null);
      setLeagueId((profRes.data as ProfileRow | null)?.active_league_id ?? null);

      // If not in a league yet, send them to /join
      if (!((profRes.data as ProfileRow | null)?.active_league_id)) {
        router.replace("/join");
        return;
      }

      setLoading(false);
    };

    run();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      run();
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [router]);

  return { loading, userId, profile, leagueId };
}