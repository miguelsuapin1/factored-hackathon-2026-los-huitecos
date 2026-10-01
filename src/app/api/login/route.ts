// Sign-in (step 8, D-006): a test login from public.app_users, or the shared demo account. Either way the session
// cookie is bound to exactly one customer id, which the lookup uses to scope every query (row-level security).
import { authenticate, type LoginResult } from "@/lib/auth/login";
import { checkCredentials, createSession, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth/session";
import { findLogin } from "@/lib/auth/users";
import { DEMO_CUSTOMER_ID } from "@/lib/lookup/mock";

export async function POST(request: Request) {
  let username = "";
  let password = "";
  try {
    const body = await request.json();
    username = typeof body.username === "string" ? body.username.trim() : "";
    password = typeof body.password === "string" ? body.password : "";
  } catch {
    return Response.json({ error: "Send your username and password." }, { status: 400 });
  }

  let who: LoginResult | null = null;
  try {
    who = await authenticate(username, password, {
      findLogin,
      demo: { username: process.env.DEMO_USERNAME, customerId: DEMO_CUSTOMER_ID, check: checkCredentials },
    });
  } catch (err) {
    // Database unreachable or not configured: say so, never fall back to letting someone in.
    console.error(JSON.stringify({ event: "login_unavailable", error: String(err) }));
    return Response.json({ error: "Sign-in is temporarily unavailable. Try again in a minute." }, { status: 503 });
  }

  if (!who) {
    await new Promise((r) => setTimeout(r, 400)); // slow down guessing
    console.warn(JSON.stringify({ event: "login_failed" }));
    return Response.json({ error: "That username and password don't match." }, { status: 401 });
  }

  const response = Response.json({ ok: true });
  const cookie = [
    `${SESSION_COOKIE}=${await createSession(who.username, who.customerId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL_SECONDS}`,
    process.env.NODE_ENV === "production" ? "Secure" : "",
  ].filter(Boolean);
  response.headers.append("Set-Cookie", cookie.join("; "));
  console.log(JSON.stringify({ event: "login_ok", kind: who.kind, user: who.username }));
  return response;
}
