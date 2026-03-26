import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export function supabaseServer() {
  const cookieStore = cookies();

  // Some Next.js versions have typing that doesn't expose getAll()/setAll() cleanly.
  // Casting avoids red squiggles while still working correctly.
  const store = cookieStore as any;

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return store.getAll?.() ?? [];
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }: any) => {
            store.set(name, value, options);
          });
        },
      },
    }
  );
}