// Session cookie: signed (HMAC-SHA256 with SESSION_SECRET), expiring, and since step 8 (D-006) bound to ONE customer.
// `c` is the customer id the login resolved; the lookup scopes every query to it (row-level security in Supabase).
// The customer id never comes from the conversation or the request body, only from this signed cookie.
// Uses Web Crypto only, so it runs in the proxy and in route handlers alike.

export const SESSION_COOKIE = "gt_session";
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

export type Payload = { u: string; c: string; exp: number };

const encoder = new TextEncoder();

function b64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(text: string) {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function key() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET is missing or shorter than 32 characters");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

/** Signs any JSON payload as `body.signature` (HMAC-SHA256 with SESSION_SECRET). Also used for conversation state. */
export async function signJson(payload: unknown) {
  const body = b64url(encoder.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await key(), encoder.encode(body)));
  return `${body}.${b64url(sig)}`;
}

/** Returns the payload if the signature is valid; otherwise null. Callers check expiry themselves. */
export async function verifyJson<T>(token: string | undefined): Promise<T | null> {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await key(), fromB64url(sig), encoder.encode(body));
    return ok ? (JSON.parse(new TextDecoder().decode(fromB64url(body))) as T) : null;
  } catch {
    return null;
  }
}

export async function createSession(username: string, customerId: string) {
  if (!customerId) throw new Error("a session needs a customer id");
  const payload: Payload = { u: username, c: customerId, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS };
  return signJson(payload);
}

/** Returns the session if the signature is valid, it hasn't expired and it names a customer; otherwise null.
 *  Cookies from before step 8 have no customer, so those users sign in again once. */
export async function verifySession(token: string | undefined): Promise<Payload | null> {
  const payload = await verifyJson<Payload>(token);
  if (!payload || typeof payload.c !== "string" || !payload.c || typeof payload.u !== "string") return null;
  return payload.exp > Date.now() / 1000 ? payload : null;
}

async function sameCredentials(username: string, password: string, expectedUser: string, expectedPass: string) {
  const digest = async (s: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(s)));
  const [a, b] = await Promise.all([digest(`${username}\n${password}`), digest(`${expectedUser}\n${expectedPass}`)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Constant-time check of the shared demo account (DEMO_USERNAME / DEMO_PASSWORD env vars). Since step 8 it signs in
 *  as the synthetic demo customer; per-customer test logins live in public.app_users (src/lib/auth/login.ts). */
export async function checkCredentials(username: string, password: string) {
  const expectedUser = process.env.DEMO_USERNAME;
  const expectedPass = process.env.DEMO_PASSWORD;
  if (!expectedUser || !expectedPass) throw new Error("DEMO_USERNAME / DEMO_PASSWORD are not configured");
  return sameCredentials(username, password, expectedUser, expectedPass);
}

// ── Agent console (step 20, D-007) ────────────────────────────────────────────────────────────────────────────────
// A separate cookie with its own payload shape ({ r: "agent" }), so a customer session can never pass as an agent's
// and the reverse: verifySession requires a customer id `c`, verifyAgentSession requires r === "agent".

export const AGENT_COOKIE = "gt_agent";
export type AgentPayload = { r: "agent"; u: string; exp: number };

export async function createAgentSession(username: string) {
  const payload: AgentPayload = { r: "agent", u: username, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS };
  return signJson(payload);
}

export async function verifyAgentSession(token: string | undefined): Promise<AgentPayload | null> {
  const payload = await verifyJson<AgentPayload>(token);
  if (!payload || payload.r !== "agent" || typeof payload.u !== "string" || "c" in payload) return null;
  return payload.exp > Date.now() / 1000 ? payload : null;
}

/** The shared agent login (AGENT_USERNAME / AGENT_PASSWORD env vars, D-007). Constant-time, like the demo account. */
export async function checkAgentCredentials(username: string, password: string) {
  const expectedUser = process.env.AGENT_USERNAME;
  const expectedPass = process.env.AGENT_PASSWORD;
  if (!expectedUser || !expectedPass) throw new Error("AGENT_USERNAME / AGENT_PASSWORD are not configured");
  if (!username || !password) return false;
  return sameCredentials(username, password, expectedUser, expectedPass);
}
