// Who is signing in, and which customer that makes them (step 8, D-006). Pure logic with injected lookups so it can be
// unit-tested; the route wires in the Supabase reader (users.ts) and the demo-account check (session.ts).
//
// Two kinds of account:
//   - Test logins in public.app_users: one per test customer, PBKDF2 password hash. This is the step-8 path.
//   - The shared demo account (DEMO_USERNAME / DEMO_PASSWORD env vars), kept so existing scripts and the judges'
//     credentials keep working. It signs in as the synthetic demo customer only.
// A username or customer number alone never signs anyone in (brief: "a national ID or customer number alone is not
// proof of identity"): every path checks a password.
import { DUMMY_HASH, verifyPassword } from "./password";

export type StoredLogin = { username: string; customerId: string; passwordHash: string; disabled: boolean };

export type LoginDeps = {
  /** Reads public.app_users. Throws if the database can't be reached (the route answers 503, it never guesses). */
  findLogin(username: string): Promise<StoredLogin | null>;
  demo: { username: string | undefined; customerId: string; check(username: string, password: string): Promise<boolean> };
};

export type LoginResult = { username: string; customerId: string; kind: "test_login" | "demo_account" };

export function normalizeUsername(raw: string) {
  return raw.trim().toLowerCase();
}

export async function authenticate(rawUsername: string, password: string, deps: LoginDeps): Promise<LoginResult | null> {
  const username = normalizeUsername(rawUsername);
  if (!username || !password || password.length > 200) return null;

  if (deps.demo.username && username === normalizeUsername(deps.demo.username)) {
    return (await deps.demo.check(deps.demo.username, password))
      ? { username, customerId: deps.demo.customerId, kind: "demo_account" }
      : null;
  }

  const login = await deps.findLogin(username);
  // Unknown user: spend the same time as a wrong password, so timing doesn't reveal which usernames exist.
  const ok = await verifyPassword(password, login?.passwordHash ?? DUMMY_HASH);
  if (!login || login.disabled || !ok) return null;
  return { username: login.username, customerId: login.customerId, kind: "test_login" };
}
