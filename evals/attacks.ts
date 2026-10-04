// Step 19 break-it cases, protocol level: forged or replayed cookies and state tokens, smuggled fields and malformed
// requests, sent straight to the API. Conversation-level attacks are in evals/cases/break.ts.
// Tampering is done as an outsider would: edit a real token and keep its old signature. Only the two expiry checks
// sign a token with SESSION_SECRET (from .env.local), to test that the server enforces `exp`; they are skipped without it.
import { signJson } from "@/lib/auth/session";
import type { AttackClass } from "./case";

export type Sent = { status: number; json: Record<string, unknown> };

export type AttackContext = {
  cookie(login: string): Promise<string | null>; // null when there's no password for that login
  post(path: string, cookie: string | null, body: unknown): Promise<Sent>; // body as JSON, or a raw string as is
  canSign: boolean; // the app's SESSION_SECRET is available (local runs only)
};

export type Verdict = { pass: boolean; expected: string; actual: string } | { skipped: string };
export type Attack = { id: string; attack: AttackClass; title: string; run(ctx: AttackContext): Promise<Verdict> };
export type AttackResult = { id: string; attack: AttackClass; title: string } & Verdict;

// --- token helpers (pure; tested in attacks.test.ts) -----------------------------------------------------------

/** A signed token is `base64url(JSON).signature` (src/lib/auth/session.ts). */
export function readToken(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8"));
}

/** Replaces the payload but keeps the original signature: what an attacker without the secret can do. */
export function tamper(token: string, edit: (payload: Record<string, unknown>) => void): string {
  const payload = readToken(token);
  edit(payload);
  return `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${token.split(".")[1]}`;
}

/** Changes one character of the body, keeping it valid base64url. */
export function flipOne(token: string): string {
  const [body, sig] = token.split(".");
  const i = Math.floor(body.length / 2);
  return `${body.slice(0, i)}${body[i] === "A" ? "B" : "A"}${body.slice(i + 1)}.${sig}`;
}

const cookieValue = (cookie: string) => cookie.slice(cookie.indexOf("=") + 1);
const cookieOf = (token: string) => `gt_session=${token}`;
const now = () => Math.floor(Date.now() / 1000);

type Conv = { state?: string; turn?: number; restartReason?: string | null; move?: string; match?: { transactionId: string } | null; case?: unknown };
const conv = (s: Sent) => (s.json.conversation ?? {}) as Conv;

const DISPUTE = "No reconozco un cargo de 350 dólares del 10 de junio";

/** Opens a dispute as demo.mx and returns its cookie and the state token after the first turn (pending confirm). */
async function started(ctx: AttackContext) {
  const cookie = await ctx.cookie("demo.mx");
  if (!cookie) return null;
  const first = await ctx.post("/api/chat", cookie, { text: DISPUTE });
  const state = conv(first).state;
  return first.status === 200 && state ? { cookie, state } : null;
}

const status = (s: Sent) => `HTTP ${s.status}${typeof s.json.error === "string" ? ` "${s.json.error}"` : ""}`;
const restart = (s: Sent) => `HTTP ${s.status}, turn ${conv(s).turn}, restart ${JSON.stringify(conv(s).restartReason)}, move ${conv(s).move}`;

export const ATTACKS: readonly Attack[] = [
  // --- sessions ------------------------------------------------------------------------------------------------
  {
    id: "S-1", attack: "unauthorized_access", title: "No session cookie: chat and classify both refuse",
    async run(ctx) {
      const chat = await ctx.post("/api/chat", null, { text: DISPUTE });
      const classify = await ctx.post("/api/classify", null, { text: DISPUTE });
      return { pass: chat.status === 401 && classify.status === 401, expected: "401 / 401", actual: `${status(chat)} / ${status(classify)}` };
    },
  },
  {
    id: "S-2", attack: "unauthorized_access", title: "Garbage session cookie is refused",
    async run(ctx) {
      const r = await ctx.post("/api/chat", cookieOf("not-a-token"), { text: DISPUTE });
      return { pass: r.status === 401, expected: "401", actual: status(r) };
    },
  },
  {
    id: "S-3", attack: "unauthorized_access", title: "Own cookie edited to another customer's id (old signature) is refused",
    async run(ctx) {
      const cookie = await ctx.cookie("demo.mx");
      if (!cookie) return { skipped: "no password for demo.mx" };
      const forged = tamper(cookieValue(cookie), (p) => { p.c = "CLI-OTHER0000000001"; });
      const r = await ctx.post("/api/chat", cookieOf(forged), { text: DISPUTE });
      return { pass: r.status === 401, expected: "401", actual: status(r) };
    },
  },
  {
    id: "S-4", attack: "expired_session", title: "Correctly signed but expired session is refused",
    async run(ctx) {
      if (!ctx.canSign) return { skipped: "needs the app's SESSION_SECRET (local runs only)" };
      const expired = await signJson({ u: "attack-test", c: "CLI-DEMO00000001", exp: now() - 60 });
      const r = await ctx.post("/api/chat", cookieOf(expired), { text: DISPUTE });
      return { pass: r.status === 401, expected: "401", actual: status(r) };
    },
  },
  {
    id: "S-5", attack: "expired_session", title: "Signed session without a customer id (pre-step-8 shape) is refused",
    async run(ctx) {
      if (!ctx.canSign) return { skipped: "needs the app's SESSION_SECRET (local runs only)" };
      const old = await signJson({ u: "attack-test", exp: now() + 3600 });
      const r = await ctx.post("/api/chat", cookieOf(old), { text: DISPUTE });
      return { pass: r.status === 401, expected: "401", actual: status(r) };
    },
  },
  {
    id: "S-6", attack: "unauthorized_access", title: "Login errors don't reveal whether the user exists",
    async run(ctx) {
      const unknown = await ctx.post("/api/login", null, { username: "no-such-user-xyz", password: "wrong-password-1" });
      const wrong = await ctx.post("/api/login", null, { username: "demo.mx", password: "wrong-password-1" });
      const same = unknown.status === 401 && wrong.status === 401 && unknown.json.error === wrong.json.error;
      return { pass: same, expected: "401 with the same message for both", actual: `${status(unknown)} / ${status(wrong)}` };
    },
  },
  // --- conversation state token (C2) ---------------------------------------------------------------------------
  {
    id: "C-1", attack: "unauthorized_access", title: "State token with one character changed: conversation restarts, nothing confirmed",
    async run(ctx) {
      const s = await started(ctx);
      if (!s) return { skipped: "couldn't start a demo.mx conversation" };
      const r = await ctx.post("/api/chat", s.cookie, { text: "sí", state: flipOne(s.state) });
      const c = conv(r);
      return { pass: r.status === 200 && c.restartReason === "invalid signature" && c.turn === 1 && c.move !== "open_review",
        expected: 'restart "invalid signature", turn 1, no review', actual: restart(r) };
    },
  },
  {
    id: "C-2", attack: "unauthorized_access", title: "State edited to swap in another customer's charge and say yes: rejected",
    async run(ctx) {
      const s = await started(ctx);
      if (!s) return { skipped: "couldn't start a demo.mx conversation" };
      const forged = tamper(s.state, (p) => {
        p.match = { transactionId: "TRX-OTHER000000000001", date: "2026-06-10", amount: 350, currency: "USD", merchant: "Super Ahorro", status: "Approved" };
        p.pending = { kind: "confirm" };
      });
      const r = await ctx.post("/api/chat", s.cookie, { text: "sí", state: forged });
      const c = conv(r);
      return { pass: r.status === 200 && c.restartReason === "invalid signature" && c.move !== "open_review" && !c.case,
        expected: 'restart "invalid signature", no review, no case', actual: `${restart(r)}, case ${JSON.stringify(c.case ?? null)}` };
    },
  },
  {
    id: "C-3", attack: "unauthorized_access", title: "demo.mx's valid state replayed with otro.mx's cookie: restarts, nothing carried over",
    async run(ctx) {
      const s = await started(ctx);
      const other = await ctx.cookie("otro.mx");
      if (!s || !other) return { skipped: "needs demo.mx and otro.mx passwords" };
      const r = await ctx.post("/api/chat", other, { text: "sí", state: s.state });
      const c = conv(r);
      return { pass: r.status === 200 && c.restartReason === "state belongs to another user" && c.turn === 1 && !c.match,
        expected: 'restart "state belongs to another user", turn 1, no match', actual: restart(r) };
    },
  },
  {
    id: "C-4", attack: "expired_session", title: "Correctly signed but expired state token: conversation restarts",
    async run(ctx) {
      if (!ctx.canSign) return { skipped: "needs the app's SESSION_SECRET (local runs only)" };
      const s = await started(ctx);
      if (!s) return { skipped: "couldn't start a demo.mx conversation" };
      const payload = readToken(s.state);
      const expired = await signJson({ ...payload, exp: now() - 60 });
      const r = await ctx.post("/api/chat", s.cookie, { text: "sí", state: expired });
      const c = conv(r);
      return { pass: r.status === 200 && c.restartReason === "state expired" && c.move !== "open_review",
        expected: 'restart "state expired", no review', actual: restart(r) };
    },
  },
  {
    id: "C-5", attack: "bad_data", title: "State that isn't a string: restarts instead of failing",
    async run(ctx) {
      const cookie = await ctx.cookie("demo.mx");
      if (!cookie) return { skipped: "no password for demo.mx" };
      const r = await ctx.post("/api/chat", cookie, { text: "hola", state: 12345 });
      return { pass: r.status === 200 && conv(r).restartReason === "state is not a string",
        expected: 'HTTP 200, restart "state is not a string"', actual: restart(r) };
    },
  },
  // --- requests ------------------------------------------------------------------------------------------------
  {
    id: "I-1", attack: "unauthorized_access", title: "A customerId smuggled into the request body is ignored",
    async run(ctx) {
      const cookie = await ctx.cookie("demo.mx");
      if (!cookie) return { skipped: "no password for demo.mx" };
      const r = await ctx.post("/api/chat", cookie, { text: DISPUTE, customerId: "CLI-OTHER0000000001", c: "CLI-OTHER0000000001" });
      const m = conv(r).match?.transactionId ?? null;
      return { pass: r.status === 200 && m === "TRX-DEMO0000000000001", expected: "HTTP 200, match TRX-DEMO0000000000001",
        actual: `HTTP ${r.status}, match ${m}` };
    },
  },
  {
    id: "I-2", attack: "bad_data", title: "A message over 500 characters is refused with 413",
    async run(ctx) {
      const cookie = await ctx.cookie("demo.mx");
      if (!cookie) return { skipped: "no password for demo.mx" };
      const r = await ctx.post("/api/chat", cookie, { text: "a".repeat(501) });
      return { pass: r.status === 413, expected: "413", actual: status(r) };
    },
  },
  {
    id: "I-3", attack: "bad_data", title: "Malformed JSON and an empty message are refused with 400, not a crash",
    async run(ctx) {
      const cookie = await ctx.cookie("demo.mx");
      if (!cookie) return { skipped: "no password for demo.mx" };
      const broken = await ctx.post("/api/chat", cookie, '{"text": "hola"');
      const empty = await ctx.post("/api/chat", cookie, { text: "   " });
      return { pass: broken.status === 400 && empty.status === 400, expected: "400 / 400", actual: `${status(broken)} / ${status(empty)}` };
    },
  },
];
