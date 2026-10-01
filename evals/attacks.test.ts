// Token helpers used by the protocol attacks (no network). Run: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { signJson, verifyJson } from "@/lib/auth/session";
import { ATTACKS, flipOne, readToken, tamper } from "./attacks";

process.env.SESSION_SECRET ??= "attacks-test-secret-attacks-test-secret";

describe("token tampering helpers", () => {
  it("reads a signed token's payload", async () => {
    assert.deepEqual(readToken(await signJson({ u: "x", c: "CLI-1" })), { u: "x", c: "CLI-1" });
  });
  it("an edited payload keeps the old signature, so the server's check rejects it", async () => {
    const token = await signJson({ u: "x", c: "CLI-1" });
    const forged = tamper(token, (p) => { p.c = "CLI-2"; });
    assert.equal(readToken(forged).c, "CLI-2");
    assert.equal(forged.split(".")[1], token.split(".")[1]);
    assert.equal(await verifyJson(forged), null);
  });
  it("one changed character also fails verification", async () => {
    const token = await signJson({ u: "x", c: "CLI-1" });
    assert.notEqual(flipOne(token), token);
    assert.equal(await verifyJson(flipOne(token)), null);
  });
});

describe("attack list", () => {
  it("has unique ids, each with a class and a title", () => {
    const ids = ATTACKS.map((a) => a.id);
    assert.deepEqual(ids, [...new Set(ids)]);
    for (const a of ATTACKS) assert.ok(a.attack && a.title, a.id);
  });
});
