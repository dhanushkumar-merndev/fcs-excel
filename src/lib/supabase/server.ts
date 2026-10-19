import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { supabasePublishableKey, supabaseUrl } from "@/lib/env";

/** Per-request client acting as the signed-in user. RLS applies to every query. */
export async function createClient() {
  // Request time, never prerendered: auth checks the session's expiry against the clock, and
  // cookies() alone still leaves the render in a prerenderable stage.
  await connection();
  const cookieStore = await cookies();
  return createServerClient(supabaseUrl(), supabasePublishableKey(), {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component render: the proxy refreshes the session instead.
        }
      },
    },
  });
}
