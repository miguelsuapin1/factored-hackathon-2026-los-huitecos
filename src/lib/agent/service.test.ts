// Agent console tests: the hand-off conversation rules, on the memory store. Run: npm test
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createMemoryAgentStore } from "./memory-store";
import { agentAction, agentCase, customerPoll, customerSend } from "./service";

const store = createMemoryAgentStore();
const REF = "GT-DEMQ6RSK";
const ME = "CLI-DEMO00000001";
beforeEach(() => store.reset());

describe("agent side", () => {
  it("lists only hand-offs, waiting first, newest first", async () => {
    const list = await store.listRequests(null);
    assert.deepEqual(list.map((i) => i.reference), ["GT-DEMQ6RSK", "GT-DEMW8TPA", "GT-DEMH4NZC"]);
    assert.equal((await store.listRequests("production")).length, 0);
  });
  it("opens a case with its briefing and no messages yet", async () => {
    const r = await agentCase(store, REF, 0);
    assert.ok(r.ok);
    assert.equal(r.value.case.status, "open");
    assert.match(r.value.briefing.paragraph, /high fraud score \(PL-6\)/);
    assert.deepEqual(r.value.messages, []);
  });
  it("can't write before accepting; accepting posts a system event; only one acceptance wins", async () => {
    assert.deepEqual(await agentAction(store, REF, "message", "Hola"), { ok: false, status: 409, error: "Accept the request before writing to the customer." });
    assert.deepEqual(await agentAction(store, REF, "accept"), { ok: true, value: { status: "in_progress" } });
    const again = await agentAction(store, REF, "accept");
    assert.equal(again.ok, false);
    assert.equal(!again.ok && again.status, 409);
    const view = await agentCase(store, REF, 0);
    assert.ok(view.ok);
    assert.deepEqual(view.value.messages.map((m) => [m.sender, m.body]), [["system", "agent_joined"]]);
  });
  it("closing ends the conversation; a closed request can't be accepted again", async () => {
    await agentAction(store, REF, "accept");
    assert.deepEqual(await agentAction(store, REF, "close"), { ok: true, value: { status: "closed" } });
    const r = await agentAction(store, REF, "accept");
    assert.ok(!r.ok && r.error === "This request is already closed.");
  });
  it("rejects bad input instead of guessing", async () => {
    assert.equal((await agentCase(store, "GT-XXXX", 0)).ok, false);
    assert.equal((await agentCase(store, "GT-ZZZZZZZZ", 0)).ok, false);
    await agentAction(store, REF, "accept");
    assert.equal((await agentAction(store, REF, "message", "   ")).ok, false);
    const long = await agentAction(store, REF, "message", "x".repeat(1001));
    assert.ok(!long.ok && long.status === 413);
    assert.equal((await agentAction(store, REF, "delete")).ok, false);
  });
});

describe("customer side", () => {
  it("sees their own case, waiting, and can't write until an agent joins", async () => {
    const p = await customerPoll(store, REF, ME, 0);
    assert.ok(p.ok && p.value.status === "open" && p.value.language === "es");
    const w = await customerSend(store, REF, ME, "hola?");
    assert.ok(!w.ok && w.error === "An agent hasn't joined yet.");
  });
  it("another customer can't read or write it: same answer as a missing case", async () => {
    await agentAction(store, REF, "accept");
    const p = await customerPoll(store, REF, "CLI-OTHER0000000001", 0);
    const w = await customerSend(store, REF, "CLI-OTHER0000000001", "hola");
    assert.deepEqual([p, w], [{ ok: false, status: 404, error: "Case not found." }, { ok: false, status: 404, error: "Case not found." }]);
  });
  it("a full exchange: messages arrive in order, polling only returns what's new, secrets are masked before storing", async () => {
    await agentAction(store, REF, "accept");
    await agentAction(store, REF, "message", "Hola Demo, soy Ana de GT Bank. ¿Tienes tu tarjeta contigo?");
    const sent = await customerSend(store, REF, ME, "sí, la tarjeta 4111 1111 1111 1111 y mi pin es 4821");
    assert.ok(sent.ok);
    assert.equal(sent.value.message.body, "sí, la tarjeta ****1111 y mi pin es [oculto]");
    assert.deepEqual(sent.value.masked.sort(), ["card", "secret"]);
    const all = await customerPoll(store, REF, ME, 0);
    assert.ok(all.ok);
    assert.deepEqual(all.value.messages.map((m) => m.sender), ["system", "agent", "customer"]);
    const newer = await customerPoll(store, REF, ME, all.value.messages[1].id);
    assert.ok(newer.ok && newer.value.messages.length === 1 && newer.value.messages[0].sender === "customer");
    await agentAction(store, REF, "close");
    const after = await customerSend(store, REF, ME, "gracias");
    assert.ok(!after.ok && after.error === "This conversation with the agent has ended.");
  });
});
