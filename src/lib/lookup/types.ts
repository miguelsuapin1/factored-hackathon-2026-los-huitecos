// Transaction lookup contract (docs/contracts.md K2). Producer: Person 2 (step 10). Consumer: the policy engine.
// Always scoped to the signed-in customer: the customer id comes from the session, never from the conversation.

export type CustomerSession = { customerId: string };

export type LookupQuery = {
  amount?: number; // matched with a 1% tolerance, in the transaction's own currency
  currency?: string | null; // ISO code if the customer named one; a preference, not a filter (customers misname it)
  dateFrom?: string; // ISO date, inclusive
  dateTo?: string; // ISO date, inclusive
  merchant?: string; // accent/case-insensitive "contains", either direction
  limit?: number; // default 5
};

export type TransactionStatus = "Approved" | "Declined" | "Pending" | "Reversed";

export type TransactionMatch = {
  transactionId: string;
  date: string; // ISO timestamp (transaction_date)
  amount: number;
  currency: string; // the record's own currency, never converted for display (data issue A5)
  merchant: string | null;
  status: TransactionStatus;
  responseCode: string | null; // not interpreted: Pending/Reversed rows carry decline codes (data issue E5)
  channel: string | null;
  country: string | null; // ISO: MX, CO, AR
  fraudScore: number | null; // policy engine only (PL-6); never shown to the customer, never stored in the state
  score: number; // how well it matches the query, 0..1
};

/** Deliberately no `is_fraud`: that label only exists after disputes are resolved (docs/policy.md PL-6). */
export type TransactionLookup = {
  source: "mock" | "supabase";
  findTransactions(session: CustomerSession, query: LookupQuery): Promise<TransactionMatch[]>;
  getTransaction(session: CustomerSession, transactionId: string): Promise<TransactionMatch | null>;
};
