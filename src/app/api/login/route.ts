import { checkCredentials, createSession, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth/session";

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

  let ok = false;
  try {
    ok = await checkCredentials(username, password);
  } catch (err) {
    console.error(JSON.stringify({ event: "login_not_configured", error: String(err) }));
    return Response.json({ error: "Sign-in isn't configured on this deployment." }, { status: 500 });
  }

  if (!ok) {
    await new Promise((r) => setTimeout(r, 400)); // slow down guessing
    console.warn(JSON.stringify({ event: "login_failed" }));
    return Response.json({ error: "That username and password don't match." }, { status: 401 });
  }

  const response = Response.json({ ok: true });
  const cookie = [
    `${SESSION_COOKIE}=${await createSession(username)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL_SECONDS}`,
    process.env.NODE_ENV === "production" ? "Secure" : "",
  ].filter(Boolean);
  response.headers.append("Set-Cookie", cookie.join("; "));
  console.log(JSON.stringify({ event: "login_ok" }));
  return response;
}
