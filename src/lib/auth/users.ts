// Reads a test login from public.app_users (D-006). Server-only: uses SUPABASE_SECRET_KEY, like the case
// store, because nobody is signed in yet. app_users grants nothing to the browser roles.
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { StoredLogin } from "./login";

const TIMEOUT_MS = 4000;
let client: SupabaseClient | null = null;

function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("SUPABASE_SECRET_KEY or NEXT_PUBLIC_SUPABASE_URL is not configured");
  client ??= createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) }) },
  });
  return client;
}

export async function findLogin(username: string): Promise<StoredLogin | null> {
  const { data, error } = await db()
    .from("app_users")
    .select("username, customer_id, password_hash, disabled")
    .eq("username", username)
    .maybeSingle();
  if (error) throw new Error(`login read failed: ${error.code ?? ""} ${error.message}`.trim());
  if (!data) return null;
  return { username: data.username, customerId: data.customer_id, passwordHash: data.password_hash, disabled: data.disabled };
}
