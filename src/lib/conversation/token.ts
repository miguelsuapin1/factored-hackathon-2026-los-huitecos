// The conversation state as a signed token (docs/conversation.md C2). A token that is tampered with, belongs to another
// user or has expired is ignored: the conversation restarts, and the trace records why.
import { randomUUID } from "node:crypto";
import { signJson, verifyJson } from "@/lib/auth/session";
import { newState, type ConversationState } from "./state";

export type Restored = { state: ConversationState; restartReason: string | null };

export async function restoreState(token: unknown, session: { u: string; exp: number }): Promise<Restored> {
  const fresh = () => newState(randomUUID(), session.u, session.exp);
  if (token === undefined || token === null || token === "") return { state: fresh(), restartReason: null };
  if (typeof token !== "string") return { state: fresh(), restartReason: "state is not a string" };
  const state = await verifyJson<ConversationState>(token);
  if (!state || state.v !== 1) return { state: fresh(), restartReason: "invalid signature" };
  if (state.user !== session.u) return { state: fresh(), restartReason: "state belongs to another user" };
  if (state.exp <= Date.now() / 1000) return { state: fresh(), restartReason: "state expired" };
  return { state, restartReason: null };
}

export function sealState(state: ConversationState) {
  return signJson(state);
}
