// Supabase case store. Server-only: uses SUPABASE_SECRET_KEY, which bypasses RLS; the `cases` table grants nothing to
// the browser roles (supabase/migrations/20260930050000_cases.sql). Every call has a timeout so a slow database
// can't hold the turn (the caller then tells the customer honestly that nothing was registered, V2).
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { newReference, type CaseInput, type CaseRecord, type CaseStore } from "./types";

const TIMEOUT_MS = 4000;

type Row = {
  id: string; reference: string; idempotency_key: string; created_at: string; kind: CaseRecord["kind"];
  status: CaseRecord["status"]; rule: string; reason: string | null; conversation_id: string; customer_id: string;
  intent: string; language: "es" | "pt"; transaction_id: string | null; summary: string;
  verified_facts: CaseRecord["verifiedFacts"]; customer_statements: Record<string, unknown>; checks_done: string[];
  open_questions: string[]; prompt_versions: Record<string, string>;
};

const toRow = (c: CaseInput, reference: string) => ({
  reference, idempotency_key: c.idempotencyKey, kind: c.kind, rule: c.rule, reason: c.reason,
  conversation_id: c.conversationId, customer_id: c.customerId, intent: c.intent, language: c.language,
  transaction_id: c.transactionId, summary: c.summary, verified_facts: c.verifiedFacts,
  customer_statements: c.customerStatements, checks_done: c.checksDone, open_questions: c.openQuestions,
  prompt_versions: c.promptVersions,
});

const fromRow = (r: Row): CaseRecord => ({
  id: r.id, reference: r.reference, createdAt: r.created_at, status: r.status, idempotencyKey: r.idempotency_key,
  kind: r.kind, rule: r.rule, reason: r.reason, conversationId: r.conversation_id, customerId: r.customer_id,
  intent: r.intent, language: r.language, transactionId: r.transaction_id, summary: r.summary,
  verifiedFacts: r.verified_facts, customerStatements: r.customer_statements, checksDone: r.checks_done,
  openQuestions: r.open_questions, promptVersions: r.prompt_versions,
});

let client: SupabaseClient | null = null;
function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("SUPABASE_SECRET_KEY or NEXT_PUBLIC_SUPABASE_URL is not configured");
  client ??= createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) }) },
  });
  return client;
}

export const supabaseStore: CaseStore = {
  source: "supabase",
  async create(input) {
    const { data, error } = await db().from("cases").insert(toRow(input, newReference())).select().single();
    if (!error) return fromRow(data as Row);
    // 23505 = unique violation: this conversation already created this case (a repeated "yes"). Return that one.
    if (error.code === "23505") {
      const existing = await db().from("cases").select().eq("idempotency_key", input.idempotencyKey).single();
      if (existing.error) throw new Error(`case exists but can't be read: ${existing.error.message}`);
      return fromRow(existing.data as Row);
    }
    throw new Error(`case insert failed: ${error.code ?? ""} ${error.message}`.trim());
  },
  async get(id) {
    const { data, error } = await db().from("cases").select().eq("id", id).maybeSingle();
    if (error) throw new Error(`case read failed: ${error.message}`);
    return data ? fromRow(data as Row) : null;
  },
};
