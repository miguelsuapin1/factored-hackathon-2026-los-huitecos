"use client";

// The agent console (step 20, D-007). Left: the inbox of hand-off requests ("request tabs"), polled every few seconds;
// a new waiting request is announced and counted in the browser tab title. Right: the selected request with its case
// table, the code-built summary, checks and open questions, and the live chat once accepted. Everything goes through
// server routes (/api/agent/*); the browser never reads the database (docs/contracts.md K6).
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { REASON_TEXT, waited, type Briefing } from "@/lib/agent/briefing";
import type { AgentCase, CaseMessage, InboxItem } from "@/lib/agent/types";
import { INTENT_LABELS } from "@/lib/intent/labels";

const INBOX_POLL_MS = 4000;
const CASE_POLL_MS = 2000;

type CaseView = { case: AgentCase; briefing: Briefing };

const STATUS_LABEL = { open: "Waiting", in_progress: "In progress", closed: "Closed" } as const;
const SYSTEM_TEXT: Record<string, string> = {
  agent_joined: "You accepted the request. The customer has been told an agent joined and can now write to you.",
  agent_closed: "You closed the conversation. The customer has been told it ended.",
};

export function AgentConsole() {
  const router = useRouter();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [env, setEnv] = useState<string>("");
  const [showAll, setShowAll] = useState(false);
  const [inboxError, setInboxError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<CaseView | null>(null);
  const [messages, setMessages] = useState<CaseMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [caseError, setCaseError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const seen = useRef<Set<string> | null>(null);
  const lastId = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  const unauthorized = useCallback((res: Response) => {
    if (res.status === 401) router.replace("/agent/login?next=/agent");
    return res.status === 401;
  }, [router]);

  // Inbox polling, with a "new request" notice the first time a waiting request shows up.
  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const res = await fetch(`/api/agent/requests${showAll ? "?all=1" : ""}`, { cache: "no-store" });
        if (unauthorized(res)) return;
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        if (stop) return;
        const list = data.items as InboxItem[];
        const waiting = list.filter((i) => i.status === "open").map((i) => i.reference);
        if (seen.current) {
          const fresh = waiting.filter((r) => !seen.current!.has(r));
          if (fresh.length) setNotice(`New request${fresh.length > 1 ? "s" : ""}: ${fresh.join(", ")}`);
        }
        seen.current = new Set([...(seen.current ?? []), ...waiting]);
        setItems(list);
        setEnv(data.environment);
        setInboxError(null);
        setNow(Date.now());
      } catch (e) {
        if (!stop) setInboxError((e as Error).message || "The request list couldn't be loaded.");
      }
    }
    load();
    const t = setInterval(load, INBOX_POLL_MS);
    return () => { stop = true; clearInterval(t); };
  }, [showAll, unauthorized]);

  useEffect(() => {
    const waiting = items.filter((i) => i.status === "open").length;
    document.title = `${waiting ? `(${waiting}) ` : ""}Agent console · GT Bank`;
  }, [items]);

  // The selected case: full load, then only new messages (and status) every 2 s.
  const loadCase = useCallback(async (ref: string, full: boolean) => {
    const res = await fetch(`/api/agent/case?ref=${encodeURIComponent(ref)}&after=${full ? 0 : lastId.current}`, { cache: "no-store" });
    if (unauthorized(res)) return;
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    setView({ case: data.case, briefing: data.briefing });
    const fresh = data.messages as CaseMessage[];
    if (full) setMessages(fresh);
    else if (fresh.length) setMessages((m) => [...m, ...fresh.filter((x) => !m.some((y) => y.id === x.id))]);
    if (fresh.length) lastId.current = Math.max(lastId.current, ...fresh.map((x) => x.id));
    setCaseError(null);
  }, [unauthorized]);

  useEffect(() => {
    if (!selected) return;
    let stop = false;
    loadCase(selected, true).catch((e) => !stop && setCaseError((e as Error).message));
    const t = setInterval(() => loadCase(selected, false).catch((e) => !stop && setCaseError((e as Error).message)), CASE_POLL_MS);
    return () => { stop = true; clearInterval(t); };
  }, [selected, loadCase]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function selectCase(ref: string) {
    if (ref === selected) return;
    lastId.current = 0;
    setView(null);
    setMessages([]);
    setCaseError(null);
    setDraft("");
    setSelected(ref);
  }

  async function act(action: "accept" | "close" | "message", text?: string) {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/agent/case", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref: selected, action, text }),
      });
      if (unauthorized(res)) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (action === "message") setDraft("");
      await loadCase(selected, false);
      setItems((list) => list.map((i) => (i.reference === selected ? { ...i, status: data.status } : i)));
    } catch (e) {
      setCaseError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const groups: [string, InboxItem[]][] = [
    ["Waiting", items.filter((i) => i.status === "open")],
    ["In progress", items.filter((i) => i.status === "in_progress")],
    ["Recently closed", items.filter((i) => i.status === "closed")],
  ];
  const c = view?.case;
  const active = c?.status === "in_progress";

  return (
    <main className="agent-shell">
      <section className="card inbox" aria-label="Hand-off requests">
        <div className="card-head">
          <div>
            <p className="label">Requests</p>
            <div className="sub">{env === "all" ? "All environments" : `Environment: ${env || "…"}`}</div>
          </div>
          <label className="toggle" htmlFor="all-envs" title="Include cases created by local runs and preview deployments (test traffic)">
            <input id="all-envs" type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            Show test traffic
          </label>
        </div>
        {notice && (
          <div className="inbox-notice" role="status">
            <span>{notice}</span>
            <button className="link" onClick={() => setNotice(null)} aria-label="Dismiss">✕</button>
          </div>
        )}
        {inboxError && <p className="form-error inbox-error">{inboxError}</p>}
        <div className="inbox-list">
          {groups.map(([title, list]) => (
            <div key={title} className="inbox-group">
              <p className="label inbox-group-title">{title} <span className="count">{list.length}</span></p>
              {list.length === 0 && <p className="sub inbox-empty">None</p>}
              {list.map((i) => (
                <button
                  key={i.reference}
                  className={`request${selected === i.reference ? " selected" : ""} ${i.status}`}
                  onClick={() => selectCase(i.reference)}
                  aria-current={selected === i.reference}
                >
                  <span className="request-top">
                    <b>{i.reference}</b>
                    <span className="request-age">{waited(i.createdAt, now)}</span>
                  </span>
                  <span className="request-topic">{INTENT_LABELS[i.intent]?.en ?? i.intent} · {i.language.toUpperCase()}</span>
                  <span className="request-why">{i.reason ? REASON_TEXT[i.reason] ?? i.reason : i.rule}</span>
                  {i.environment && i.environment !== "production" && <span className="request-env">{i.environment}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section className="card case" aria-label="Selected request">
        {!selected && (
          <div className="placeholder case-placeholder">
            Select a request on the left. Each one is a customer the assistant handed to a person, with the facts it
            verified and a summary of the conversation.
          </div>
        )}
        {selected && !view && !caseError && <div className="placeholder case-placeholder">Loading {selected}…</div>}
        {caseError && <p className="form-error case-error" role="alert">{caseError}</p>}
        {view && c && (
          <>
            <div className="card-head">
              <div>
                <p className="label">{c.reference} · {STATUS_LABEL[c.status]}</p>
                <div className="case-headline">{view.briefing.headline}</div>
              </div>
              <div className="case-actions">
                {c.status === "open" && <button className="btn" onClick={() => act("accept")} disabled={busy}>Accept request</button>}
                {active && <button className="link-btn" onClick={() => act("close")} disabled={busy}>Close conversation</button>}
              </div>
            </div>

            <div className="case-body">
              <div className="section">
                <p className="label">What happened</p>
                <p className="briefing">{view.briefing.paragraph}</p>
              </div>
              <div className="section">
                <p className="label">Case facts</p>
                <table className="case-table">
                  <tbody>
                    {view.briefing.rows.map(([k, v]) => (
                      <tr key={k}><th scope="row">{k}</th><td>{v}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {c.openQuestions.length > 0 && (
                <div className="section">
                  <p className="label">Open questions for you</p>
                  <ul className="case-list">{c.openQuestions.map((q) => <li key={q}>{q}</li>)}</ul>
                </div>
              )}
              {c.checksDone.length > 0 && (
                <details className="section checks">
                  <summary className="label">What the assistant checked ({c.checksDone.length})</summary>
                  <ol className="case-list mono">{c.checksDone.map((x, n) => <li key={n}>{x}</li>)}</ol>
                </details>
              )}

              <div className="section agent-chat">
                <p className="label">Conversation with the customer</p>
                <div className="agent-messages" ref={listRef} aria-live="polite">
                  {c.status === "open" && <p className="sub">Accept the request to start the conversation. The customer is waiting in the chat.</p>}
                  {messages.map((m) =>
                    m.sender === "system" ? (
                      <div key={m.id} className="msg-system">{SYSTEM_TEXT[m.body] ?? m.body}</div>
                    ) : (
                      <div key={m.id} className={`msg ${m.sender === "agent" ? "user" : "bot"}`}>
                        <span className="reply-text">{m.body}</span>
                        <span className="reply-meta">{m.sender === "agent" ? "You" : "Customer"} · {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                    ),
                  )}
                </div>
                {active && (
                  <form className="input-row" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) act("message", draft); }}>
                    <input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder={c.language === "pt" ? "Escreva ao cliente em português…" : "Escribe al cliente en español…"}
                      maxLength={1000}
                      aria-label="Message to the customer"
                      autoComplete="off"
                    />
                    <button className="btn" type="submit" disabled={busy || !draft.trim()}>Send</button>
                  </form>
                )}
              </div>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
