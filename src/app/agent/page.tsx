import { AgentConsole } from "@/components/AgentConsole";
import { AgentHeader } from "@/components/AgentHeader";

// Protected by src/proxy.ts: only reachable with an agent session (step 20, D-007).
export default function AgentPage() {
  return (
    <>
      <AgentHeader />
      <AgentConsole />
    </>
  );
}
