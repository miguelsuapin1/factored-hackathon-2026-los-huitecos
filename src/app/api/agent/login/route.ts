// Agent sign-in (D-007): one shared agent login from env (AGENT_USERNAME / AGENT_PASSWORD). Sets the agent
// cookie, which only the agent console accepts (src/proxy.ts).
import { AGENT_COOKIE, checkAgentCredentials, createAgentSession, SESSION_TTL_SECONDS } from "@/lib/auth/session";

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
    ok = await checkAgentCredentials(username, password);
  } catch (err) {
    console.error(JSON.stringify({ event: "agent_login_not_configured", error: String(err) }));
    return Response.json({ error: "Agent sign-in isn't configured on this deployment." }, { status: 503 });
  }
  if (!ok) {
    await new Promise((r) => setTimeout(r, 400)); // slow down guessing
    console.warn(JSON.stringify({ event: "agent_login_failed" }));
    return Response.json({ error: "That username and password don't match." }, { status: 401 });
  }
  const response = Response.json({ ok: true });
  response.headers.append("Set-Cookie", [
    `${AGENT_COOKIE}=${await createAgentSession(username)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${SESSION_TTL_SECONDS}`,
    process.env.NODE_ENV === "production" ? "Secure" : "",
  ].filter(Boolean).join("; "));
  console.log(JSON.stringify({ event: "agent_login_ok" }));
  return response;
}
