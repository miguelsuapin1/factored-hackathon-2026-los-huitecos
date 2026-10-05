// Which agent store serves the routes (step 20). Supabase whenever SUPABASE_SECRET_KEY is set; the seeded memory
// store only on a laptop without it, so the console can be tried locally. Production always uses Supabase: a missing
// key there is an error (503), never a silent switch to fake data.
import "server-only";
import { createMemoryAgentStore } from "./memory-store";
import { supabaseAgentStore } from "./supabase-store";
import type { AgentStore } from "./types";

const memory = createMemoryAgentStore();

export function agentStore(): AgentStore {
  if (process.env.SUPABASE_SECRET_KEY || process.env.VERCEL_ENV === "production") return supabaseAgentStore;
  return memory;
}

/** Which cases the inbox shows by default: the ones this deployment created (production, preview or local). */
export function currentEnvironment() {
  return process.env.VERCEL_ENV ?? "local";
}
