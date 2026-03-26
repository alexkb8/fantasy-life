"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

export default function LoginPage() {
  const router = useRouter();

  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const onSubmit = async () => {
    setLoading(true);
    setMsg("");

    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              display_name: displayName || email.split("@")[0],
            },
          },
        });

        if (error) throw error;
        setMsg("Account created. Logging you in / sending confirmation depending on your Supabase settings.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;
      }

      router.replace("/join");
    } catch (e: any) {
      setMsg(e.message ?? "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-md px-5 py-12">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-black">fantasy-life</h1>
          <p className="mt-1 text-sm text-slate-600">Log in to play.</p>

          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={() => setMode("signup")}
              className={[
                "flex-1 rounded-2xl border px-4 py-2 text-sm font-black",
                mode === "signup"
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-900",
              ].join(" ")}
            >
              Sign up
            </button>
            <button
              type="button"
              onClick={() => setMode("login")}
              className={[
                "flex-1 rounded-2xl border px-4 py-2 text-sm font-black",
                mode === "login"
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-900",
              ].join(" ")}
            >
              Log in
            </button>
          </div>

          <div className="mt-4 grid gap-3">
            {mode === "signup" && (
              <input
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold outline-none"
                placeholder="Display name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            )}

            <input
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold outline-none"
              placeholder="Email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />

            <input
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold outline-none"
              placeholder="Password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />

            <button
              type="button"
              onClick={onSubmit}
              disabled={loading || !email || !password}
              className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white disabled:opacity-60"
            >
              {loading ? "Working..." : mode === "signup" ? "Create account" : "Log in"}
            </button>

            {msg && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                {msg}
              </div>
            )}
          </div>

          <div className="mt-5 text-xs text-slate-500">
            Easy multiplayer testing: use multiple browser sessions, or emails like
            <code className="ml-1">you+1@gmail.com</code>,
            <code className="ml-1">you+2@gmail.com</code>.
          </div>
        </div>
      </div>
    </main>
  );
}