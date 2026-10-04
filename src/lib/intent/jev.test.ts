// The Jev experiment's adapter (docs/intent-model.md D18): privacy at its boundary, the validated question, the toggle
// gate and error mapping. No network: fetch is injected. Run: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import config from "@/lib/intent-model-jev.json";
import { classifyJev, jevEnabled, JevError, jevRequestBody, parseJevAnswer } from "./jev";

const probs = (top: string, p: number) =>
  Object.fromEntries(config.labels.map((l) => [l, l === top ? p : Number(((1 - p) / 6).toFixed(4))]));

describe("Jev adapter (D18)", () => {
  it("H4: sensitive data never reaches TypeSafe, even if a caller forgot to mask", () => {
    const raw = "mi tarjeta 4111 1111 1111 1111, 4821 es mi pin, escríbeme a ana@correo.com o al +52 55 1234 5678";
    const sent = JSON.stringify(jevRequestBody(raw));
    for (const secret of ["4111 1111", "1111 1111 1111 1111", "4821", "ana@correo.com", "1234 5678"]) {
      assert.ok(!sent.includes(secret), `"${secret}" reached the request body`);
    }
    assert.ok(sent.includes("****1111") && sent.includes("[oculto]") && sent.includes("[email]"));
  });
  it("asks exactly the question measured on validation, with the pinned model", () => {
    const body = jevRequestBody("No reconozco un cargo de 350 dólares");
    assert.equal(body.model, "jev-1.13.0");
    assert.deepEqual(body.questions.intent, { type: "choice", instructions: config.instructions, criteria: config.criteria });
    assert.deepEqual(Object.keys(config.criteria), config.labels);
    assert.deepEqual(body.state, { message: "No reconozco un cargo de 350 dólares" });
  });
  it("is only available where the server switches it on and a key exists", () => {
    assert.equal(jevEnabled({ JEV_TOGGLE: "1", TYPESAFE_API_KEY: "k" }), true);
    assert.equal(jevEnabled({ JEV_TOGGLE: "1" }), false);
    assert.equal(jevEnabled({ TYPESAFE_API_KEY: "k" }), false);
    assert.equal(jevEnabled({ JEV_TOGGLE: "true", TYPESAFE_API_KEY: "k" }), false);
  });
  it("turns Jev's answer into our scores, highest first, all seven intents", () => {
    const { scores } = parseJevAnswer({ model: "jev-1.13.0", answers: { intent: { probabilities: probs("wrongful_fee", 0.97) } } });
    assert.equal(scores.length, 7);
    assert.deepEqual(scores[0], { label: "wrongful_fee", probability: 0.97 });
  });
  it("rejects an answer missing an intent instead of guessing", () => {
    const partial = probs("wrongful_fee", 0.97);
    delete partial.move_money;
    assert.throws(() => parseJevAnswer({ answers: { intent: { probabilities: partial } } }), (e) => e instanceof JevError && e.kind === "bad_response");
    assert.throws(() => parseJevAnswer(null), JevError);
  });
  it("maps failures to kinds the trace can show (and never calls out without a key)", async () => {
    const respond = (status: number) => (async () => new Response("{}", { status })) as typeof fetch;
    const kind = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e as JevError).kind);
    assert.equal(await kind(classifyJev("hola", { apiKey: "k", fetchImpl: respond(401) })), "auth");
    assert.equal(await kind(classifyJev("hola", { apiKey: "k", fetchImpl: respond(429) })), "throttled");
    assert.equal(await kind(classifyJev("hola", { apiKey: "k", fetchImpl: respond(503) })), "unavailable");
    const timeout = (async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); }) as typeof fetch;
    assert.equal(await kind(classifyJev("hola", { apiKey: "k", fetchImpl: timeout })), "timeout");
    let called = false;
    const spy = (async () => { called = true; return new Response("{}"); }) as typeof fetch;
    const saved = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    assert.equal(await kind(classifyJev("hola", { fetchImpl: spy })), "disabled");
    if (saved !== undefined) process.env.TYPESAFE_API_KEY = saved;
    assert.equal(called, false);
  });
  it("sends the key only in the Authorization header, and the masked text in the body", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const capture = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ model: "jev-1.13.0", answers: { intent: { probabilities: probs("human_agent", 1) } } }));
    }) as unknown as typeof fetch;
    const out = await classifyJev("quiero un asesor, mi cvv es 987", { apiKey: "secret-key", fetchImpl: capture });
    assert.equal(out.scores[0].label, "human_agent");
    assert.ok(seen);
    const s = seen as { url: string; init: RequestInit };
    assert.equal(s.url, "https://api.typesafe.ai/v1/systemone");
    assert.equal((s.init.headers as Record<string, string>).Authorization, "Bearer secret-key");
    assert.ok(!String(s.init.body).includes("secret-key") && !String(s.init.body).includes("987"));
  });
});
