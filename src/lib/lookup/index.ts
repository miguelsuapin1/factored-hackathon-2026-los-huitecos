// The one place that picks the lookup implementation (docs/contracts.md K2).
// The Supabase lookup (Carlos, 2026-10-01) whenever SUPABASE_LOOKUP_DB_URL is set (Vercel production and
// preview); otherwise the synthetic stand-in, so a laptop without database credentials still runs the demo customer.
// The trace records which one answered (`policy.lookup.source`). D-006: the customer comes from the session.
import { lookupConfigured } from "@/lib/db/scoped";
import { mockLookup } from "./mock";
import { supabaseLookup } from "./supabase";
import type { CustomerSession, TransactionLookup } from "./types";

export const lookup: TransactionLookup = lookupConfigured() ? supabaseLookup : mockLookup;

/** The signed-in customer, from the signed session cookie (src/lib/auth/session.ts) and nowhere else. */
export function customerFor(session: { c: string }): CustomerSession {
  if (!session.c) throw new Error("session has no customer");
  return { customerId: session.c };
}

export type { CustomerSession, LookupQuery, TransactionMatch, TransactionLookup } from "./types";
