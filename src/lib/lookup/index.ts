// The one place that picks the lookup implementation. Person 2: when the Supabase lookup (step 10) is ready,
// export it here instead of the mock; nothing else changes. The session → customer mapping becomes real in step 8.
import { DEMO_CUSTOMER_ID, mockLookup } from "./mock";
import type { CustomerSession, TransactionLookup } from "./types";

export const lookup: TransactionLookup = mockLookup;

/** Step 8 replaces this: today every demo sign-in is the one synthetic demo customer. */
export function customerFor(user: string): CustomerSession {
  void user; // step 8: map the signed-in user to their own customer id
  return { customerId: DEMO_CUSTOMER_ID };
}

export type { CustomerSession, LookupQuery, TransactionMatch, TransactionLookup } from "./types";
