// Demo access gate: a signed, expiring session cookie (HMAC-SHA256 with SESSION_SECRET).
// This protects the demo and the Bedrock quota; it is NOT customer authentication (that's build step 8).
// Uses Web Crypto only, so it runs in the proxy and in route handlers alike.

export const SESSION_COOKIE = "gt_session";
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

export type Payload = { u: string; exp: number };

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

export async function createSession(username: string) {
  const payload: Payload = { u: username, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS };
  return signJson(payload);
}

/** Returns the session if the signature is valid and it hasn't expired; otherwise null. */
export async function verifySession(token: string | undefined): Promise<Payload | null> {
  const payload = await verifyJson<Payload>(token);
  return payload && payload.exp > Date.now() / 1000 ? payload : null;
}

/** Constant-time check of the demo credentials (DEMO_USERNAME / DEMO_PASSWORD env vars). */
export async function checkCredentials(username: string, password: string) {
  const expectedUser = process.env.DEMO_USERNAME;
  const expectedPass = process.env.DEMO_PASSWORD;
  if (!expectedUser || !expectedPass) throw new Error("DEMO_USERNAME / DEMO_PASSWORD are not configured");
  const digest = async (s: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(s)));
  const [a, b] = await Promise.all([digest(`${username}\n${password}`), digest(`${expectedUser}\n${expectedPass}`)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
