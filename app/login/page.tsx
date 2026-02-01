"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

import { useRouter, useSearchParams } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";

  useEffect(() => {
    // If already logged in, bounce to next
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace(next);
    });
  }, [router, next]);

  const sendMagicLink = async () => {
    setStatus("");
    setLoading(true);

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          // after clicking email link, send them here
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });

      if (error) throw error;

      setStatus("Check your email for a magic link. Click it to sign in.");
    } catch (e: any) {
      setStatus(e?.message ?? "Failed to send magic link.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-10 text-slate-900">
      <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold">Sign in</h1>
        <p className="mt-2 text-sm text-slate-600">
          We’ll email you a magic link. No password.
        </p>

        <div className="mt-5">
          <label className="text-sm font-semibold text-slate-700">Email</label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
          />
        </div>

        <button
          onClick={sendMagicLink}
          disabled={loading || !email.includes("@")}
          className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {loading ? "Sending…" : "Send magic link"}
        </button>

        {status && <div className="mt-4 text-sm text-slate-600">{status}</div>}

        <div className="mt-6 text-xs text-slate-500">
          Tip: Use the same email each time—your profile + avatar will stick to that account.
        </div>
      </div>
    </main>
  );
}
