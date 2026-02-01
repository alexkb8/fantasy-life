"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import AvatarUploader from "../components/AvatarUploader";

type Profile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  handle: string | null;
};

export default function ProfilePage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [msg, setMsg] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      setChecking(true);
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id ?? null;

      if (cancelled) return;
      setUserId(uid);

      if (!uid) {
        router.replace("/login?next=/profile");
        return;
      }

      const { data: prof, error } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url, handle")
        .eq("id", uid)
        .single();

      if (!cancelled && !error) setProfile(prof as Profile);
      if (!cancelled) setChecking(false);
    };

    init();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (checking) {
    return (
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-sm text-slate-600">Loading profile…</div>
        </div>
      </main>
    );
  }

  if (!userId) return null;

  const save = async () => {
    const display_name = (document.getElementById("display_name") as HTMLInputElement)?.value ?? "";
    const handle = (document.getElementById("handle") as HTMLInputElement)?.value ?? "";

    setMsg("");

    const { error } = await supabase
      .from("profiles")
      .update({ display_name, handle: handle.trim() || null })
      .eq("id", userId);

    if (error) {
      setMsg(error.message);
      return;
    }

    setMsg("Saved!");
    setProfile((p) => (p ? { ...p, display_name, handle: handle.trim() || null } : p));
  };

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold">Profile</h1>

        <div className="mt-5 grid gap-4">
          <div>
            <label className="text-sm font-semibold text-slate-700">Display name</label>
            <input
              id="display_name"
              defaultValue={profile?.display_name ?? ""}
              className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              placeholder="Your name"
            />
          </div>

          <div>
            <label className="text-sm font-semibold text-slate-700">Handle (links you to game user_id)</label>
            <input
              id="handle"
              defaultValue={profile?.handle ?? ""}
              className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              placeholder="alex  (or bob / jeff / sean)"
            />
            <div className="mt-1 text-xs text-slate-500">
              This must match the strings used in <code>tasks.user_id</code> and <code>team_picks.manager_id</code>.
            </div>
          </div>

          <button
            onClick={save}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Save
          </button>
        </div>

        <div className="mt-6">
          <label className="text-sm font-semibold text-slate-700">Avatar</label>
          <div className="mt-2">
            <AvatarUploader
              userId={userId}
              currentAvatarUrl={profile?.avatar_url ?? null}
              onUploaded={(url) => setProfile((p) => (p ? { ...p, avatar_url: url } : p))}
              onMessage={setMsg}
            />
          </div>
        </div>

        {msg && <div className="mt-4 text-sm text-slate-600">{msg}</div>}
      </div>
    </main>
  );
}
