// Production wiring of the Supabase lookup (step 10): the SQL lookup on the customer-scoped connection (role
// lookup_reader, env SUPABASE_LOOKUP_DB_URL). Server-only.
import "server-only";
import { asCustomer } from "@/lib/db/scoped";
import { sqlLookup } from "./sql";

export const supabaseLookup = sqlLookup(asCustomer);
