import { AGENT_COOKIE } from "@/lib/auth/session";

export async function POST() {
  const response = Response.json({ ok: true });
  response.headers.append("Set-Cookie", `${AGENT_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return response;
}
