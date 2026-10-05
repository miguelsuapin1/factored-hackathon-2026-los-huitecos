// One hand-off case for the agent (step 20): GET ?ref=GT-XXXXXXXX&after=<last message id> → briefing + new messages.
// POST { ref, action: "accept" | "close" | "message", text? }. Rules in src/lib/agent/service.ts.
import { agentAction, agentCase } from "@/lib/agent/service";
import { agentStore } from "@/lib/agent/store";

const unavailable = (err: unknown) => {
  console.error(JSON.stringify({ event: "agent_case_failed", error: String(err) }));
  return Response.json({ error: "The case couldn't be loaded or saved. Try again in a moment." }, { status: 503 });
};

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  try {
    const r = await agentCase(agentStore(), q.get("ref"), q.get("after"));
    return r.ok ? Response.json(r.value) : Response.json({ error: r.error }, { status: r.status });
  } catch (err) {
    return unavailable(err);
  }
}

export async function POST(request: Request) {
  let body: { ref?: unknown; action?: unknown; text?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send JSON: { ref, action, text? }" }, { status: 400 });
  }
  try {
    const r = await agentAction(agentStore(), body.ref, body.action, body.text);
    if (r.ok) console.log(JSON.stringify({ event: "agent_action", action: body.action, ref: body.ref }));
    return r.ok ? Response.json(r.value) : Response.json({ error: r.error }, { status: r.status });
  } catch (err) {
    return unavailable(err);
  }
}
