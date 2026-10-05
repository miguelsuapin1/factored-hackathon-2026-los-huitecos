"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

/** Agent sign-in: same look as the customer form, posts to /api/agent/login, lands on /agent. */
export function AgentSignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/agent/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
      });
      if (!res.ok) {
        setError((await res.json().catch(() => ({}))).error ?? "Sign-in failed. Try again.");
        return;
      }
      const next = params.get("next");
      router.replace(next && next.startsWith("/agent") && !next.startsWith("//") ? next : "/agent");
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="signin-form" onSubmit={onSubmit}>
      <label className="field" htmlFor="agent-username">
        <span>Agent username</span>
        <input id="agent-username" name="username" autoComplete="username" required autoFocus />
      </label>
      <label className="field" htmlFor="agent-password">
        <span>Password</span>
        <input id="agent-password" name="password" type="password" autoComplete="current-password" required />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="btn block" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in to the console"}</button>
    </form>
  );
}
