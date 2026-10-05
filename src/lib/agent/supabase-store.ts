// Agent console store on Supabase (D-007). Server-only: uses SUPABASE_SECRET_KEY, like the case store,
// because agents work across customers. public.cases and public.case_messages grant nothing to the browser roles;
// every browser request goes through a server route that checks the agent (or the owning customer) first.
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AgentCase } from "./briefing";
import type { AgentStore, CaseMessage, InboxItem, Sender } from "./types";

const TIMEOUT_MS = 4000;
const CLOSED_SHOWN = 15;
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

const fail = (what: string, e: { code?: string; message: string }) => new Error(`${what}: ${e.code ?? ""} ${e.message}`.trim());

type CaseRow = {
  id: string; reference: string; created_at: string; status: AgentCase["status"]; rule: string; reason: string | null;
  customer_id: string; intent: string; language: "es" | "pt"; transaction_id: string | null; summary: string;
  verified_facts: AgentCase["verifiedFacts"]; customer_statements: Record<string, unknown>; checks_done: string[];
  open_questions: string[]; prompt_versions: Record<string, string> | null;
};

const INBOX_COLUMNS = "reference, created_at, status, rule, reason, intent, language, customer_id, summary, prompt_versions";
const toInbox = (r: Omit<CaseRow, "id" | "transaction_id" | "verified_facts" | "customer_statements" | "checks_done" | "open_questions">): InboxItem => ({
  reference: r.reference, createdAt: r.created_at, status: r.status, rule: r.rule, reason: r.reason, intent: r.intent,
  language: r.language, customerId: r.customer_id, environment: r.prompt_versions?.environment ?? null, summary: r.summary,
});
const toMessage = (r: { id: number; created_at: string; sender: Sender; body: string }): CaseMessage =>
  ({ id: r.id, createdAt: r.created_at, sender: r.sender, body: r.body });

export const supabaseAgentStore: AgentStore = {
  source: "supabase",

  async listRequests(environment) {
    const base = () => {
      let q = db().from("cases").select(INBOX_COLUMNS).eq("kind", "handoff");
      if (environment) q = q.eq("prompt_versions->>environment", environment);
      return q;
    };
    const [active, closed] = await Promise.all([
      base().in("status", ["open", "in_progress"]).order("created_at", { ascending: false }).limit(200),
      base().eq("status", "closed").order("created_at", { ascending: false }).limit(CLOSED_SHOWN),
    ]);
    if (active.error) throw fail("inbox read failed", active.error);
    if (closed.error) throw fail("inbox read failed", closed.error);
    return [...(active.data ?? []), ...(closed.data ?? [])].map((r) => toInbox(r as CaseRow));
  },

  async getCase(reference) {
    const { data, error } = await db().from("cases").select("*").eq("reference", reference).eq("kind", "handoff").maybeSingle();
    if (error) throw fail("case read failed", error);
    if (!data) return null;
    const r = data as CaseRow;
    const [cust, tx] = await Promise.all([
      db().from("customers").select("first_name, country, segment, customer_status, data_source").eq("customer_id", r.customer_id).maybeSingle(),
      r.transaction_id
        ? db().from("transactions").select("transaction_id, transaction_date_local, amount, currency, merchant_name, transaction_status, response_code, channel, transaction_country, fraud_score")
            .eq("transaction_id", r.transaction_id).eq("customer_id", r.customer_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (cust.error) throw fail("customer read failed", cust.error);
    if (tx.error) throw fail("transaction read failed", tx.error);
    const c = cust.data;
    const t = tx.data;
    return {
      case: {
        id: r.id, reference: r.reference, createdAt: r.created_at, status: r.status, rule: r.rule, reason: r.reason,
        customerId: r.customer_id, intent: r.intent, language: r.language, transactionId: r.transaction_id, summary: r.summary,
        verifiedFacts: r.verified_facts ?? [], customerStatements: r.customer_statements ?? {}, checksDone: r.checks_done ?? [],
        openQuestions: r.open_questions ?? [], environment: r.prompt_versions?.environment ?? null,
      },
      customer: c ? { firstName: c.first_name, country: c.country, segment: c.segment, status: c.customer_status, dataSource: c.data_source } : null,
      transaction: t ? {
        transactionId: t.transaction_id, dateLocal: t.transaction_date_local, amount: Number(t.amount), currency: t.currency,
        merchant: t.merchant_name, status: t.transaction_status, responseCode: t.response_code, channel: t.channel,
        country: t.transaction_country, fraudScore: t.fraud_score === null ? null : Number(t.fraud_score),
      } : null,
    };
  },

  async messages(caseId, afterId) {
    const { data, error } = await db().from("case_messages").select("id, created_at, sender, body")
      .eq("case_id", caseId).gt("id", afterId).order("id", { ascending: true }).limit(200);
    if (error) throw fail("messages read failed", error);
    return (data ?? []).map(toMessage);
  },

  async accept(reference) {
    const { data, error } = await db().from("cases").update({ status: "in_progress" })
      .eq("reference", reference).eq("kind", "handoff").eq("status", "open").select("id");
    if (error) throw fail("accept failed", error);
    if (data && data.length === 1) {
      await this.addMessage(data[0].id, "system", "agent_joined");
      return "accepted";
    }
    const now = await db().from("cases").select("status").eq("reference", reference).eq("kind", "handoff").maybeSingle();
    if (now.error) throw fail("accept check failed", now.error);
    if (!now.data) return "not_found";
    return now.data.status === "closed" ? "closed" : "already_taken";
  },

  async close(reference) {
    const { data, error } = await db().from("cases").update({ status: "closed" })
      .eq("reference", reference).eq("kind", "handoff").eq("status", "in_progress").select("id");
    if (error) throw fail("close failed", error);
    if (data && data.length === 1) {
      await this.addMessage(data[0].id, "system", "agent_closed");
      return "closed";
    }
    const now = await db().from("cases").select("status").eq("reference", reference).eq("kind", "handoff").maybeSingle();
    if (now.error) throw fail("close check failed", now.error);
    return now.data ? "not_active" : "not_found";
  },

  async addMessage(caseId, sender, body) {
    const { data, error } = await db().from("case_messages").insert({ case_id: caseId, sender, body })
      .select("id, created_at, sender, body").single();
    if (error) throw fail("message write failed", error);
    return toMessage(data);
  },

  async caseForCustomer(reference, customerId) {
    const { data, error } = await db().from("cases").select("id, status, language")
      .eq("reference", reference).eq("kind", "handoff").eq("customer_id", customerId).maybeSingle();
    if (error) throw fail("case read failed", error);
    return data ? { id: data.id, status: data.status, language: data.language } : null;
  },
};
