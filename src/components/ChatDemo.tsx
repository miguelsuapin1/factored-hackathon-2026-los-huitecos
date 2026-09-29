"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { IntentResult } from "@/lib/intent/classify";
import type { ReplyResult } from "@/lib/reply/compose";
import { INTENT_LABELS, MODEL_LABELS } from "@/lib/intent/labels";

type Message =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "bot"; result: IntentResult; reply: ReplyResult }
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
        body: JSON.stringify({ text: clean, forceFallback: simulateOutage }),
      });
      if (res.status === 401) {
        // Session expired: back to sign-in, then return here.
        router.replace("/?next=/app");
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      const id = nextId.current++;
      setMessages((m) => [...m, { id, role: "bot", result: data.intent as IntentResult, reply: data.reply as ReplyResult }]);
      setSelected(id);
    } catch (err) {
      setMessages((m) => [...m, { id: nextId.current++, role: "error", text: (err as Error).message }]);
    } finally {
      setBusy(false);
    }
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
                Each message is classified into one of 7 intents. When the model isn&apos;t confident enough, the system
                asks a clarifying question instead of acting. Try an example below.
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
                  {INTENT_LABELS[m.result.intent]?.en} · {pct(m.result.confidence)} ·{" "}
                  {m.result.decision === "act" ? "acting" : "asking to clarify"}
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
        {current ? <Inspector result={current.result} reply={current.reply} /> : (
          <div className="placeholder">Send a message to see the intent, confidence and the model that answered.</div>
        )}
        <div className="note">
          Replies don&apos;t use account data yet: the assistant asks for details instead of looking them up.
          Account lookups, confirmations and human handoff come in the next steps.
        </div>
      </aside>
    </main>
  );
}

function Inspector({ result, reply }: { result: IntentResult; reply: ReplyResult }) {
  const names = INTENT_LABELS[result.intent];
  const model = MODEL_LABELS[result.model];
  const act = result.decision === "act";
  const top = result.scores.slice(0, 4);
  return (
    <>
      <div className="section">
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
