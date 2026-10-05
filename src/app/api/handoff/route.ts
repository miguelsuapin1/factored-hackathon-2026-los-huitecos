// The customer's side of a hand-off: GET ?ref=&after= polls their own case's status and new agent messages;
// POST { ref, text } writes to the agent once one has joined. The customer comes from the signed session cookie and
// can only reach a case created for them (another customer's reference answers 404, like a missing one).
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { customerPoll, customerSend } from "@/lib/agent/service";
import { agentStore } from "@/lib/agent/store";

async function customer() {
  return verifySession((await cookies()).get(SESSION_COOKIE)?.value).catch(() => null);
}
const unavailable = (err: unknown) => {
  console.error(JSON.stringify({ event: "handoff_chat_failed", error: String(err) }));
  return Response.json({ error: "We couldn't reach the agent chat. Try again in a moment." }, { status: 503 });
};

export async function GET(request: Request) {
  const session = await customer();
  if (!session) return Response.json({ error: "Your session expired or you're not signed in." }, { status: 401 });
  const q = new URL(request.url).searchParams;
  try {
    const r = await customerPoll(agentStore(), q.get("ref"), session.c, q.get("after"));
    return r.ok ? Response.json(r.value) : Response.json({ error: r.error }, { status: r.status });
  } catch (err) {
    return unavailable(err);
  }
}

export async function POST(request: Request) {
  const session = await customer();
  if (!session) return Response.json({ error: "Your session expired or you're not signed in." }, { status: 401 });
  let body: { ref?: unknown; text?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send JSON: { ref, text }" }, { status: 400 });
  }
  try {
    const r = await customerSend(agentStore(), body.ref, session.c, body.text);
    return r.ok ? Response.json(r.value) : Response.json({ error: r.error }, { status: r.status });
  } catch (err) {
    return unavailable(err);
  }
}
