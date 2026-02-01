"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function AuthCallbackPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const [msg, setMsg] = useState("Signing you in…");

  useEffect(() => {
    let cancelled = false;

    const go = (path: string) => {
      if (cancelled) return;
      router.replace(path);
    };

    const run = async () => {
      const next = sp.get("next") || "/";

      // 1) If already signed in, never show "missing code" — just continue.
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData.session) {
        setMsg("Signed in. Redirecting…");
        go(next);
        return;
      }

      // 2) PKCE flow: magic link returns ?code=...
      const code = sp.get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          setMsg(`Sign-in failed: ${error.message}`);
          return;
        }
        setMsg("Signed in. Redirecting…");
        go(next);
        return;
      }

      // 3) Some links return tokens in the URL hash (#access_token=...)
      // supabase-js can parse/store that with getSessionFromUrl
      try {
        // @ts-ignore - depending on supabase-js versions, typings vary
        const { data, error } = await supabase.auth.getSessionFromUrl({ storeSession: true });
        if (!error && data?.session) {
          setMsg("Signed in. Redirecting…");
          go(next);
          return;
        }
      } catch {
        // ignore
      }

      // 4) If no code and no session, user hit this page directly or link was consumed.
      setMsg("Missing code for sign in. Please go back and sign in again.");
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [router, sp]);

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-10 text-slate-900">
      <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold">Finishing sign-in</h1>
        <p className="mt-2 text-sm text-slate-600">{msg}</p>

        <div className="mt-4 text-xs text-slate-500">
          If you keep seeing this, try opening <span className="font-mono">/login</span> and requesting a new link.
        </div>
      </div>
    </main>
  );
}
