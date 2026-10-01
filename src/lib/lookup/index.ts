// The one place that picks the lookup implementation. Person 2: when the Supabase lookup (step 10) is ready,
// export it here instead of the mock; nothing else changes. Step 8 (D-006): the customer comes from the signed session.
import { mockLookup } from "./mock";
import type { CustomerSession, TransactionLookup } from "./types";

export const lookup: TransactionLookup = mockLookup;

/** The signed-in customer, from the signed session cookie (src/lib/auth/session.ts) and nowhere else. */
export function customerFor(session: { c: string }): CustomerSession {
  if (!session.c) throw new Error("session has no customer");
  return { customerId: session.c };
}

export type { CustomerSession, LookupQuery, TransactionMatch, TransactionLookup } from "./types";
