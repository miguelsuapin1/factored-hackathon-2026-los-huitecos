import { AppHeader } from "@/components/AppHeader";
import { ChatDemo } from "@/components/ChatDemo";
import { jevEnabled } from "@/lib/intent/jev";

// Protected by src/proxy.ts: only reachable with a valid demo session.
export default function AssistantPage() {
  return (
    <>
      <AppHeader />
      <ChatDemo jevAvailable={jevEnabled()} />
    </>
  );
}
