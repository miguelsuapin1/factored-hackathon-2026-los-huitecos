"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { IntentResult } from "@/lib/intent/classify";
import type { ReplyResult } from "@/lib/reply/compose";
import { INTENT_LABELS, MODEL_LABELS } from "@/lib/intent/labels";

// The `conversation` block of /api/chat (docs/contracts.md K1).
type Conversation = {
  state: string;
  turn: number;
  workingIntent: string | null;
  resolvedBy: string;
  move: string;
  details: { amount: number | null; expectedAmount: number | null; currency: string | null; date: string | null; merchant: string | null };
  missing: string[];
  status: string;
  restartReason: string | null;
  masked: string[];
  match: { amount: number; currency: string; merchant: string | null; date: string; status: string } | null;
  policy: { rule: string | null; decision: string | null; lookup: { source: string; count: number | null } | null };
  handoffReason: string | null;
  case: { reference: string | null; verified: boolean; kind: string } | null;
  extraction: { source: string; dropped: string[]; error: string | null; ms: number };
};

type Message =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "bot"; result: IntentResult; reply: ReplyResult; conversation: Conversation }
  | { id: number; role: "error"; text: string };

const EXAMPLES = [
  { lang: "ES", text: "No reconozco un cargo de 350 pesos en mi tarjeta" },
  { lang: "PT", text: "Me cobraram duas vezes a mesma compra no mercado" },
  { lang: "ES", text: "¿Por qué rechazaron mi tarjeta si tengo saldo?" },
  { lang: "PT", text: "Quanto eu tenho na poupança?" },
  { lang: "ES", text: "Devuélvanme la plata ya" },
  { lang: "PT", text: "Quero falar com um atendente" },
  { lang: "ES", text: "Me cobraron algo raro" },
  { lang: "PT", text: "Qual o horário da agência?" },
];

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function ChatDemo() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [simulateOutage, setSimulateOutage] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const nextId = useRef(1);
  const stateToken = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function send(text: string) {
    const clean = text.trim();
    if (!clean || busy) return;
    setDraft("");
    setBusy(true);
    setMessages((m) => [...m, { id: nextId.current++, role: "user", text: clean }]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: clean, forceFallback: simulateOutage, state: stateToken.current }),
      });
      if (res.status === 401) {
        // Session expired: back to sign-in, then return here.
        router.replace("/?next=/app");
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      const id = nextId.current++;
      const conversation = data.conversation as Conversation;
      stateToken.current = conversation.state;
      setMessages((m) => [...m, { id, role: "bot", result: data.intent as IntentResult, reply: data.reply as ReplyResult, conversation }]);
      setSelected(id);
    } catch (err) {
      setMessages((m) => [...m, { id: nextId.current++, role: "error", text: (err as Error).message }]);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    stateToken.current = null;
    setMessages([]);
    setSelected(null);
  }

  const botMessages = messages.filter((m): m is Extract<Message, { role: "bot" }> => m.role === "bot");
  const current = botMessages.find((m) => m.id === selected) ?? botMessages.at(-1);

  return (
    <main className="shell">
      <section className="card chat" aria-label="Conversation">
        <div className="card-head">
          <div>
            <p className="label">Dispute assistant · preview</p>
            <div className="sub">Write like a customer, in Spanish or Portuguese</div>
          </div>
          <button className="link" onClick={reset} disabled={busy || messages.length === 0}>New conversation</button>
          <label className="toggle" htmlFor="outage">
            <input id="outage" type="checkbox" checked={simulateOutage} onChange={(e) => setSimulateOutage(e.target.checked)} />
            Simulate AWS outage
          </label>
        </div>

        <div className="messages" ref={listRef} aria-live="polite">
          {messages.length === 0 && (
            <div className="empty">
              <h2>What does the customer want?</h2>
              <p className="sub">
                Each message is classified into one of 7 intents, and the assistant remembers the conversation: the
                topic, the amount, date and merchant you mentioned, and what it asked you. It confirms the details
                before doing anything. Try an example below.
              </p>
            </div>
          )}
          {messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="msg user">{m.text}</div>
            ) : m.role === "error" ? (
              <div key={m.id} className="msg error">{m.text}</div>
            ) : (
              <div key={m.id} className={`msg bot${current?.id === m.id ? " active" : ""}`}>
                <span className="reply-text">{m.reply.text}</span>
                <span className="reply-meta">
                  {m.conversation.workingIntent ? INTENT_LABELS[m.conversation.workingIntent]?.en : "Topic not set"} ·{" "}
                  {MOVE_LABELS[m.conversation.move] ?? m.conversation.move}
                  {m.conversation.workingIntent !== m.result.intent ? ` · model alone: ${INTENT_LABELS[m.result.intent]?.en} ${pct(m.result.confidence)}` : ` · ${pct(m.result.confidence)}`}
                  {m.result.model === "e5small" ? " · fallback model" : ""}
                  {m.reply.source === "template" ? " · template reply" : ""} ·{" "}
                  <button className="link" onClick={() => setSelected(m.id)}>details</button>
                </span>
              </div>
            ),
          )}
          {busy && <div className="typing">Writing a reply…</div>}
        </div>

        <div className="composer">
          <div className="chips" aria-label="Example messages">
            {EXAMPLES.map((e) => (
              <button key={e.text} className="chip" onClick={() => send(e.text)} disabled={busy}>
                <span className="lang">{e.lang}</span>
                {e.text}
              </button>
            ))}
          </div>
          <form
            className="input-row"
            onSubmit={(e) => {
              e.preventDefault();
              send(draft);
            }}
          >
            <input
              id="message"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Escribe tu mensaje… / Escreva sua mensagem…"
              maxLength={500}
              autoComplete="off"
              aria-label="Message"
            />
            <button className="btn" type="submit" disabled={busy || !draft.trim()}>
              Send
            </button>
          </form>
        </div>
      </section>

      <aside className="card inspector" aria-label="How the system understood the message">
        <div className="card-head">
          <p className="label">Understanding</p>
          {current && <span className="trace">trace {current.result.traceId.slice(0, 8)}</span>}
        </div>
        {current ? <Inspector result={current.result} reply={current.reply} conversation={current.conversation} /> : (
          <div className="placeholder">Send a message to see the intent, confidence and the model that answered.</div>
        )}
        <div className="note">
          Transactions come from a synthetic demo customer until the real lookup is connected. No money is ever moved:
          a dispute goes to review or to a person, by rule.
        </div>
      </aside>
    </main>
  );
}

const MOVE_LABELS: Record<string, string> = {
  ask_clarify: "asking to clarify",
  ask_summary: "asking for a one-line summary for the agent",
  ask_details: "asking for missing details",
  confirm: "asking to confirm",
  ask_correction: "asking what to correct",
  confirmed: "details confirmed",
  status_update: "case already in progress",
  answer: "answering",
  handoff: "passing to an agent",
  no_match: "no matching charge, asking to check",
  ask_narrow: "several matches, asking which one",
  explain_status: "explaining the charge's status",
  open_review: "review registered",
  record_failed: "couldn't register: nothing claimed",
};

const RULE_LABELS: Record<string, string> = {
  "PL-1": "no matching charge",
  "PL-2": "several matching charges",
  "PL-3": "charge still pending: no dispute",
  "PL-4": "charge already reversed: no dispute",
  "PL-5": "charge was declined: no dispute",
  "PL-6": "high fraud score: a person takes it",
  "PL-7": "low risk: goes to review",
  "PL-8": "record unavailable: a person takes it",
};

const RESOLVED_LABELS: Record<string, string> = {
  model: "the intent model",
  clarification: "the answer to the clarifying question",
  offer: "the option chosen from the ones offered",
  kept_topic: "the ongoing topic (low-confidence follow-up)",
  new_topic: "a confident change of topic",
  confirmation: "the confirmation step",
};

function ConversationPanel({ c }: { c: Conversation }) {
  const d = c.details;
  const rows: [string, string | null][] = [
    ["Amount", d.amount !== null ? `${d.amount}${d.currency ? ` ${d.currency}` : ""}` : null],
    ["Should have been", d.expectedAmount !== null ? String(d.expectedAmount) : null],
    ["Date", d.date],
    ["Merchant", d.merchant],
  ];
  return (
    <div className="section">
      <p className="label">Conversation · turn {c.turn}</p>
      <p className="explain">
        Topic: <b>{c.workingIntent ? INTENT_LABELS[c.workingIntent]?.en : "not set yet"}</b>, decided by{" "}
        {RESOLVED_LABELS[c.resolvedBy] ?? c.resolvedBy}. Next move: <b>{MOVE_LABELS[c.move] ?? c.move}</b>.
      </p>
      <dl className="facts">
        {rows.map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd>{v ?? (c.missing.includes(k.toLowerCase()) ? "missing" : "—")}</dd></div>
        ))}
        <div><dt>Extraction</dt><dd>{c.extraction.source} · {c.extraction.ms} ms</dd></div>
        <div><dt>Status</dt><dd>{c.status}{c.handoffReason ? ` · ${c.handoffReason}` : ""}</dd></div>
        {c.match && (
          <div style={{ gridColumn: "1 / -1" }}>
            <dt>Matched charge ({c.policy.lookup?.source ?? "lookup"})</dt>
            <dd>{c.match.amount} {c.match.currency} · {c.match.merchant ?? "—"} · {c.match.date} · {c.match.status}</dd>
          </div>
        )}
        {c.case && (
          <div style={{ gridColumn: "1 / -1" }}>
            <dt>Case ({c.case.kind})</dt>
            <dd>{c.case.verified ? `${c.case.reference} · written and read back` : "not verified: the customer was told nothing was registered"}</dd>
          </div>
        )}
        {c.policy.rule && (
          <div style={{ gridColumn: "1 / -1" }}><dt>Policy rule</dt><dd>{c.policy.rule}: {RULE_LABELS[c.policy.rule] ?? c.policy.decision}</dd></div>
        )}
        {c.extraction.dropped.length > 0 && (
          <div style={{ gridColumn: "1 / -1" }}><dt>Dropped (not found in the message)</dt><dd>{c.extraction.dropped.join(", ")}</dd></div>
        )}
        {c.masked.length > 0 && (
          <div style={{ gridColumn: "1 / -1" }}><dt>Masked before processing</dt><dd>{c.masked.join(", ")} (never sent to the models or stored)</dd></div>
        )}
        {c.restartReason && <div style={{ gridColumn: "1 / -1" }}><dt>Conversation restarted</dt><dd>{c.restartReason}</dd></div>}
      </dl>
    </div>
  );
}

function Inspector({ result, reply, conversation }: { result: IntentResult; reply: ReplyResult; conversation: Conversation }) {
  const names = INTENT_LABELS[result.intent];
  const model = MODEL_LABELS[result.model];
  const act = result.decision === "act";
  const top = result.scores.slice(0, 4);
  return (
    <>
      <ConversationPanel c={conversation} />
      <div className="section">
        <p className="label">This message on its own (intent model)</p>
        <div>
          <h2 className="intent-name">{names?.en}</h2>
          <div className="intent-es">{names?.es} · {names?.pt}</div>
        </div>
        <div className="pills">
          <span className={`pill ${act ? "act" : "ask"}`}><span className="dot" />{act ? "Would act" : "Would ask to clarify"}</span>
          <span className={`pill ${result.model === "e5small" ? "fallback" : "primary"}`}>
            <span className="dot" />{result.model === "e5small" ? "Fallback model" : "Primary model"}
          </span>
        </div>
        <p className="explain">
          {act
            ? `Confidence ${pct(result.confidence)} is at or above this model's threshold of ${pct(result.threshold)}, so the system would proceed with this intent.`
            : `Confidence ${pct(result.confidence)} is below this model's threshold of ${pct(result.threshold)}, so the system would ask a clarifying question instead of guessing.`}
        </p>
      </div>

      <div className="section">
        <div className="meter-wrap">
          <div className="meter-top"><span>Confidence</span><b className="num">{pct(result.confidence)}</b></div>
          <div className="meter" role="img" aria-label={`Confidence ${pct(result.confidence)}, threshold ${pct(result.threshold)}`}>
            <span className={`fill${act ? "" : " ask"}`} style={{ width: pct(result.confidence) }} />
            <span className="tick" style={{ left: `calc(${pct(result.threshold)} - 1px)` }} title={`Threshold ${pct(result.threshold)}`} />
          </div>
          <div className="meter-legend"><span>0%</span><span>threshold {pct(result.threshold)}</span><span>100%</span></div>
        </div>
        <p className="label" style={{ marginTop: 6 }}>Top intents</p>
        <ul className="scores">
          {top.map((s, i) => (
            <li key={s.label} className={`score${i === 0 ? " top" : ""}`}>
              <span className="name">{INTENT_LABELS[s.label]?.en}</span>
              <span className="bar"><span style={{ width: pct(s.probability) }} /></span>
              <span className="pct">{pct(s.probability)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="section">
        <dl className="facts">
          <div><dt>Model</dt><dd>{model?.name}</dd></div>
          <div><dt>Where</dt><dd>{model?.where}</dd></div>
          <div><dt>Total time</dt><dd>{Math.round(result.totalMs)} ms</dd></div>
          <div><dt>Model version</dt><dd>{result.modelVersion}</dd></div>
          {result.fallbackReason && <div style={{ gridColumn: "1 / -1" }}><dt>Why the fallback</dt><dd>{result.fallbackReason}</dd></div>}
        </dl>
        <ul className="attempts" aria-label="Attempts">
          {result.attempts.map((a, i) => (
            <li key={i} className="attempt">
              <span>{i + 1}. {MODEL_LABELS[a.model]?.name}</span>
              <span>
                <span className={a.ok ? "ok" : "bad"}>{a.ok ? "ok" : a.error}</span> · {Math.round(a.ms)} ms
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="section">
        <p className="label">Reply</p>
        <div className="pills">
          <span className={`pill ${reply.source === "haiku" ? "primary" : "fallback"}`}>
            <span className="dot" />{reply.source === "haiku" ? "Written by Claude Haiku" : "Template reply"}
          </span>
          <span className="pill ask"><span className="dot" />{reply.language === "pt" ? "Portuguese" : "Spanish"}</span>
        </div>
        <dl className="facts">
          <div><dt>Time</dt><dd>{Math.round(reply.ms)} ms</dd></div>
          <div><dt>Prompt version</dt><dd>{reply.promptVersion}</dd></div>
          <div><dt>Tokens in / out</dt><dd>{reply.inputTokens} / {reply.outputTokens}</dd></div>
          <div><dt>Cost</dt><dd>${reply.costUsd.toFixed(5)}</dd></div>
          {reply.fallbackReason && <div style={{ gridColumn: "1 / -1" }}><dt>Why the template</dt><dd>{reply.fallbackReason}</dd></div>}
        </dl>
      </div>
    </>
  );
}
