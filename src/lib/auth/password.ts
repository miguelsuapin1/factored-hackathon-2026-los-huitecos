// Password hashing for the step-8 test logins (D-006). PBKDF2-HMAC-SHA256 through Web Crypto, so no extra library and
// it runs in route handlers and tests alike. Format: pbkdf2-sha256$<iterations>$<salt b64url>$<hash b64url>.
// pipeline/seed_test_users.py writes the same format with Python's hashlib (a cross-check is in password.test.ts).

export const PBKDF2_ITERATIONS = 600_000; // OWASP 2023 recommendation for PBKDF2-SHA256
const MAX_ITERATIONS = 2_000_000; // refuse absurd stored values (a slow-hash DoS)
const HASH_BYTES = 32;
const SALT_BYTES = 16;

const encoder = new TextEncoder();

function b64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(text: string) {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function derive(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, key, HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, iterations = PBKDF2_ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  return `pbkdf2-sha256$${iterations}$${b64url(salt)}$${b64url(await derive(password, salt, iterations))}`;
}

/** True only if `stored` is a well-formed hash of `password`. Constant-time comparison of the digests. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, saltText, hashText, ...rest] = stored.split("$");
  const iterations = Number(iter);
  if (scheme !== "pbkdf2-sha256" || rest.length || !saltText || !hashText) return false;
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) return false;
  let expected: Uint8Array;
  let salt: Uint8Array;
  try {
    expected = fromB64url(hashText);
    salt = fromB64url(saltText);
  } catch {
    return false;
  }
  const actual = await derive(password, salt, iterations);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

/** Spent on unknown usernames so a miss takes as long as a wrong password (no username probing by timing). */
export const DUMMY_HASH = "pbkdf2-sha256$600000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
