// Evaluation harness (build steps 17–18): replays test conversations against a running app, sending each message with
// the state token from the previous answer, and grades every turn on the machine-readable fields of POST /api/chat
// (docs/contracts.md K1), not on the reply wording.
//
// Usage: npm run eval -- [--base http://localhost:3000] [--suite tc] [--case TC-01] [--repeat 3] [--fallback]
//                        [--rate 15] [--out evals/runs/name.json]
// Logins (docs/contracts.md K5): demo.mx uses DEMO_USERNAME / DEMO_PASSWORD from .env.local; the other logins are read
// from the git-ignored test-users.local.md (pipeline/seed_test_users.py). A case whose login has no password is
// skipped, not failed.
// --repeat: model-backed flows vary between runs (docs/lessons-learned.md P19: one bug showed up 1 run in 9).
// --rate caps turns per minute: each turn makes one Cohere call, and Bedrock allows 20 per minute.
// Every review or hand-off writes a real case, tagged environment "local" (or the deployment's VERCEL_ENV).
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import type { Case } from "./case";
import { TC } from "./cases/tc";
import { gradeCase, observe, type ChatResponse, type Grade, type Observed } from "./grade";

const SUITES: Record<string, readonly Case[]> = { tc: TC };
const ROOT = process.cwd();

type Credential = { username: string; password: string };

type TurnRecord = {
  say: string;
  httpStatus: number;
  ms: number;
  error?: string;
  observed?: Observed;
  intent?: { label: string; confidence: number; decision: string; model: string; modelVersion: string; fallbackReason: string | null; ms: number };
  reply?: { source: string; fallbackReason: string | null; promptVersion: string; ms: number; costUsd: number };
  extraction?: { source: string; promptVersion: string; dropped: string[]; ms: number; costUsd: number };
  caseReference?: string | null;
};

/** The /api/chat response fields the runner records, on top of what the grader reads. */
type ApiResponse = ChatResponse & {
  error?: string;
  intent: { intent: string; confidence: number; decision: string; model: string; modelVersion: string; fallbackReason: string | null; totalMs: number };
  reply: ChatResponse["reply"] & { source: string; fallbackReason: string | null; promptVersion: string; ms: number; costUsd: number };
  conversation: ChatResponse["conversation"] & {
    extraction: { source: string; promptVersion: string; dropped: string[]; ms: number; costUsd: number };
  };
};

type CaseResult = { id: string; run: number; login: string; skipped?: string; grade?: Grade; turns: TurnRecord[] };

function readEnvLocal(): Record<string, string> {
  const file = path.join(ROOT, ".env.local");
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(fs.readFileSync(file, "utf8").split("\n").filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
}

/** test-users.local.md rows look like: | `username` | `password` | CLI-... | ... */
function readTestUsers(): Map<string, Credential> {
  const file = path.join(ROOT, "test-users.local.md");
  const users = new Map<string, Credential>();
  if (!fs.existsSync(file)) return users;
  for (const m of fs.readFileSync(file, "utf8").matchAll(/^\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/gm)) {
    users.set(m[1], { username: m[1], password: m[2] });
  }
  return users;
}

function credentials(): Map<string, Credential> {
  const users = readTestUsers();
  const env = { ...readEnvLocal(), ...process.env };
  if (!users.has("demo.mx") && env.DEMO_USERNAME && env.DEMO_PASSWORD) {
    users.set("demo.mx", { username: env.DEMO_USERNAME, password: env.DEMO_PASSWORD });
  }
  return users;
}

async function login(base: string, cred: Credential): Promise<string> {
  const r = await fetch(`${base}/api/login`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cred), redirect: "manual",
  }).catch(() => {
    throw new Error(`can't reach ${base}: is the app running (npm run dev)?`);
  });
  const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  if (!r.ok || !cookie) throw new Error(`login as ${cred.username} failed: HTTP ${r.status}`);
  return cookie;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function percentile(values: number[], p: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

async function main() {
  const { values } = parseArgs({
    options: {
      base: { type: "string", default: "http://localhost:3000" },
      suite: { type: "string", default: "tc" },
      case: { type: "string" },
      repeat: { type: "string", default: "1" },
      fallback: { type: "boolean", default: false },
      rate: { type: "string", default: "15" },
      out: { type: "string" },
    },
  });
  const suite = SUITES[values.suite];
  if (!suite) throw new Error(`unknown suite "${values.suite}"; known: ${Object.keys(SUITES).join(", ")}`);
  const cases = values.case ? suite.filter((c) => c.id === values.case) : suite;
  if (!cases.length) throw new Error(`no case "${values.case}" in suite "${values.suite}"`);
  const repeat = Math.max(1, Number(values.repeat));
  const gapMs = 60_000 / Math.max(1, Number(values.rate));
  const base = values.base.replace(/\/$/, "");

  const creds = credentials();
  const cookies = new Map<string, string>();
  const results: CaseResult[] = [];
  const startedAt = new Date();
  let lastTurnAt = 0;

  for (let run = 1; run <= repeat; run++) {
    for (const c of cases) {
      const result: CaseResult = { id: c.id, run, login: c.login, turns: [] };
      results.push(result);
      const cred = creds.get(c.login);
      if (!cred) {
        result.skipped = `no password for ${c.login}`;
        console.log(`- ${c.id.padEnd(8)} skipped: ${result.skipped}`);
        continue;
      }
      if (!cookies.has(c.login)) cookies.set(c.login, await login(base, cred));

      let state: string | null = null;
      const observed: Observed[] = [];
      for (const turn of c.turns) {
        const wait = lastTurnAt + gapMs - Date.now();
        if (wait > 0) await sleep(wait);
        lastTurnAt = Date.now();
        const record: TurnRecord = { say: turn.say, httpStatus: 0, ms: 0 };
        result.turns.push(record);
        try {
          const r: Response = await fetch(`${base}/api/chat`, {
            method: "POST", headers: { "Content-Type": "application/json", cookie: cookies.get(c.login)! },
            body: JSON.stringify({ text: turn.say, state, forceFallback: values.fallback }),
          });
          record.httpStatus = r.status;
          record.ms = Date.now() - lastTurnAt;
          const j = (await r.json()) as ApiResponse;
          if (!r.ok) {
            record.error = j.error ?? `HTTP ${r.status}`;
            break;
          }
          const o = observe(j);
          observed.push(o);
          state = j.conversation.state;
          record.observed = o;
          record.intent = { label: j.intent.intent, confidence: j.intent.confidence, decision: j.intent.decision, model: j.intent.model,
            modelVersion: j.intent.modelVersion, fallbackReason: j.intent.fallbackReason, ms: Math.round(j.intent.totalMs) };
          record.reply = { source: j.reply.source, fallbackReason: j.reply.fallbackReason, promptVersion: j.reply.promptVersion,
            ms: Math.round(j.reply.ms), costUsd: j.reply.costUsd };
          const x = j.conversation.extraction;
          record.extraction = { source: x.source, promptVersion: x.promptVersion, dropped: x.dropped, ms: x.ms, costUsd: x.costUsd };
          record.caseReference = j.conversation.case?.reference ?? null;
        } catch (err) {
          record.ms = Date.now() - lastTurnAt;
          record.error = String(err);
          break;
        }
      }

      result.grade = gradeCase(c, observed);
      const g = result.grade;
      const moves = observed.map((o) => o.move).join(" → ");
      const why = [
        ...g.mismatches.map((m) => `turn ${m.turn} ${m.field}: expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.actual)}`),
        ...(g.completed ? [] : [`stopped at turn ${result.turns.length}: ${result.turns.at(-1)?.error}`]),
        ...(g.outcome !== g.expected ? [`outcome ${g.outcome}, expected ${g.expected}`] : []),
        ...g.leaks.map((s) => `LEAK "${s}"`),
      ];
      console.log(`${g.pass ? "✓" : "✗"} ${c.id.padEnd(8)}${repeat > 1 ? ` #${run}` : ""} ${moves}`);
      for (const line of why) console.log(`    ${line}`);
    }
  }

  const graded = results.filter((r) => r.grade);
  const turnMs = graded.flatMap((r) => r.turns.filter((t) => t.httpStatus === 200).map((t) => t.ms));
  const summary = {
    cases: results.length,
    passed: graded.filter((r) => r.grade!.pass).length,
    failed: graded.filter((r) => !r.grade!.pass).length,
    skipped: results.filter((r) => r.skipped).length,
    turns: turnMs.length,
    wrongActions: graded.filter((r) => r.grade!.wrongAction).length,
    leaks: graded.filter((r) => r.grade!.leaks.length).length,
    missedHandoffs: graded.filter((r) => r.grade!.missedHandoff).length,
    unnecessaryHandoffs: graded.filter((r) => r.grade!.unnecessaryHandoff).length,
    templateReplies: graded.flatMap((r) => r.turns).filter((t) => t.reply?.source === "template").length,
    turnMsP50: percentile(turnMs, 50),
    turnMsP95: percentile(turnMs, 95),
    costUsd: Number(graded.flatMap((r) => r.turns).reduce((s, t) => s + (t.reply?.costUsd ?? 0) + (t.extraction?.costUsd ?? 0), 0).toFixed(6)),
  };
  let commit = "unknown";
  try {
    commit = execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim();
  } catch {}
  const out = values.out ?? path.join(ROOT, "evals", "runs", `${values.suite}-${startedAt.toISOString().replace(/[:.]/g, "-")}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({
    run: { startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(), base, commit, suite: values.suite,
      case: values.case ?? null, repeat, fallback: values.fallback, ratePerMin: Number(values.rate) },
    summary,
    results,
  }, null, 2));

  console.log(`\n${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped; ${summary.turns} turns, ` +
    `p50 ${summary.turnMsP50} ms, p95 ${summary.turnMsP95} ms, $${summary.costUsd}; wrong actions ${summary.wrongActions}, ` +
    `leaks ${summary.leaks}, missed hand-offs ${summary.missedHandoffs}, unnecessary ${summary.unnecessaryHandoffs}`);
  console.log(`results: ${path.relative(ROOT, out)}`);
  if (summary.failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(String(err instanceof Error ? err.message : err));
  process.exitCode = 2;
});
