// Step 8 tests (D-006): password hashing, who a sign-in resolves to, and that a session always names one customer.
// The database half (row-level security) is checked by supabase/tests/step8_rls_check.sql. Run: npm test
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { authenticate, type LoginDeps, type StoredLogin } from "./login";
import { hashPassword, verifyPassword } from "./password";
import { createSession, signJson, verifySession } from "./session";

// Low iteration count so the suite stays fast; the format and code path are the real ones.
const FAST = 1000;

describe("password hashing", () => {
  it("verifies the right password and rejects a wrong one", async () => {
    const h = await hashPassword("Contraseña-1", FAST);
    assert.match(h, /^pbkdf2-sha256\$1000\$[\w-]+\$[\w-]+$/);
    assert.equal(await verifyPassword("Contraseña-1", h), true);
    assert.equal(await verifyPassword("contraseña-1", h), false);
    assert.equal(await verifyPassword("", h), false);
  });
  it("salts every hash", async () => {
    assert.notEqual(await hashPassword("same", FAST), await hashPassword("same", FAST));
  });
  it("accepts a hash written by pipeline/seed_test_users.py (Python hashlib, same format)", async () => {
    const fromPython = "pbkdf2-sha256$1000$AAECAwQFBgcICQoLDA0ODw$5kbVWW5r5ztcIaj8_HEol0K1VuMEM_RB0I2udsrouvM";
    assert.equal(await verifyPassword("Contraseña-1", fromPython), true);
    assert.equal(await verifyPassword("Contrasena-1", fromPython), false);
  });
  it("rejects malformed or hostile stored values instead of throwing", async () => {
    for (const bad of ["", "plaintext", "md5$1$a$b", "pbkdf2-sha256$abc$AA$AA", "pbkdf2-sha256$99999999$AA$AA",
      "pbkdf2-sha256$1000$AA$AA$extra", "pbkdf2-sha256$1000$$"]) {
      assert.equal(await verifyPassword("x", bad), false, bad);
    }
  });
});

describe("authenticate", () => {
  const users: Record<string, StoredLogin> = {};
  let lookups = 0;
  const deps: LoginDeps = {
    async findLogin(u) {
      lookups++;
      return users[u] ?? null;
    },
    demo: { username: "Demo", customerId: "CLI-DEMO00000001", check: async (_u, p) => p === "demo-pass" },
  };
  before(async () => {
    users["mx.pending"] = { username: "mx.pending", customerId: "CLI-ET8RX4AC7A0W", passwordHash: await hashPassword("pw-a", FAST), disabled: false };
    users["co.off"] = { username: "co.off", customerId: "CLI-BHJ7KIAHF2PG", passwordHash: await hashPassword("pw-b", FAST), disabled: true };
  });

  it("signs a test user in as their own customer (username is case-insensitive)", async () => {
    assert.deepEqual(await authenticate("  MX.Pending ", "pw-a", deps),
      { username: "mx.pending", customerId: "CLI-ET8RX4AC7A0W", kind: "test_login" });
  });
  it("refuses a wrong password, an unknown user and a disabled user", async () => {
    assert.equal(await authenticate("mx.pending", "pw-b", deps), null);
    assert.equal(await authenticate("nobody", "pw-a", deps), null);
    assert.equal(await authenticate("co.off", "pw-b", deps), null);
  });
  it("never signs in with a customer id or username alone (brief: an id is not proof of identity)", async () => {
    assert.equal(await authenticate("mx.pending", "", deps), null);
    assert.equal(await authenticate("CLI-ET8RX4AC7A0W", "CLI-ET8RX4AC7A0W", deps), null);
  });
  it("the shared demo account signs in as the synthetic demo customer only, without reading app_users", async () => {
    const before = lookups;
    assert.deepEqual(await authenticate("demo", "demo-pass", deps),
      { username: "demo", customerId: "CLI-DEMO00000001", kind: "demo_account" });
    assert.equal(await authenticate("demo", "wrong", deps), null);
    assert.equal(lookups, before);
  });
  it("lets a database error surface (the route answers 503) instead of signing anyone in", async () => {
    const down: LoginDeps = { ...deps, findLogin: async () => { throw new Error("db down"); } };
    await assert.rejects(authenticate("mx.pending", "pw-a", down), /db down/);
  });
});

describe("session", () => {
  before(() => {
    process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret-42";
  });
  it("carries the customer the login resolved", async () => {
    const s = await verifySession(await createSession("mx.pending", "CLI-ET8RX4AC7A0W"));
    assert.equal(s?.c, "CLI-ET8RX4AC7A0W");
    assert.equal(s?.u, "mx.pending");
  });
  it("refuses a cookie from before step 8 (no customer) and an expired one", async () => {
    const now = Math.floor(Date.now() / 1000);
    assert.equal(await verifySession(await signJson({ u: "demo", exp: now + 60 })), null);
    assert.equal(await verifySession(await signJson({ u: "demo", c: "", exp: now + 60 })), null);
    assert.equal(await verifySession(await signJson({ u: "demo", c: "CLI-DEMO00000001", exp: now - 1 })), null);
  });
  it("refuses a cookie whose customer was edited (signature no longer matches)", async () => {
    const token = await createSession("mx.pending", "CLI-ET8RX4AC7A0W");
    const [body, sig] = token.split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    const forged = Buffer.from(JSON.stringify({ ...payload, c: "CLI-DEMO00000001" })).toString("base64url");
    assert.equal(await verifySession(`${forged}.${sig}`), null);
  });
  it("can't be created without a customer", async () => {
    await assert.rejects(createSession("demo", ""), /customer/);
  });
});
