// The agent inbox: hand-off requests, waiting and in progress, plus the latest closed ones.
// ?all=1 shows every environment; by default only this deployment's (so test traffic stays out of production's view).
import { agentStore, currentEnvironment } from "@/lib/agent/store";

export async function GET(request: Request) {
  const all = new URL(request.url).searchParams.get("all") === "1";
  const store = agentStore();
  try {
    const items = await store.listRequests(all ? null : currentEnvironment());
    return Response.json({ environment: all ? "all" : currentEnvironment(), source: store.source, items });
  } catch (err) {
    console.error(JSON.stringify({ event: "agent_inbox_failed", error: String(err) }));
    return Response.json({ error: "The request list couldn't be loaded. Try again in a moment." }, { status: 503 });
  }
}
