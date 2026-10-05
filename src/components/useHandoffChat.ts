"use client";

// The customer's side of a hand-off (step 20, D-007): after the assistant hands the conversation to a person and the
// case is verified, poll /api/handoff for the case's status and the agent's messages; while an agent is on the case,
// the customer's messages go to the agent instead of the assistant.
import { useCallback, useEffect, useRef, useState } from "react";
import type { CaseMessage, CaseStatus } from "@/lib/agent/types";

const POLL_MS = 2000;

export function useHandoffChat() {
  const [reference, setReference] = useState<string | null>(null);
  const [status, setStatus] = useState<CaseStatus | null>(null);
  const [language, setLanguage] = useState<"es" | "pt">("es");
  const [messages, setMessages] = useState<CaseMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const lastId = useRef(0);

  const merge = useCallback((fresh: CaseMessage[]) => {
    if (!fresh.length) return;
    setMessages((m) => [...m, ...fresh.filter((x) => !m.some((y) => y.id === x.id))]);
    lastId.current = Math.max(lastId.current, ...fresh.map((x) => x.id));
  }, []);

  useEffect(() => {
    if (!reference || status === "closed") return;
    let stop = false;
    async function poll() {
      try {
        const res = await fetch(`/api/handoff?ref=${encodeURIComponent(reference!)}&after=${lastId.current}`, { cache: "no-store" });
        const data = await res.json();
        if (stop) return;
        if (!res.ok) throw new Error(data.error);
        setStatus(data.status);
        setLanguage(data.language);
        merge(data.messages);
        setError(null);
      } catch (e) {
        if (!stop) setError((e as Error).message);
      }
    }
    poll();
    const t = setInterval(poll, POLL_MS);
    return () => { stop = true; clearInterval(t); };
  }, [reference, status, merge]);

  const start = useCallback((ref: string) => {
    setReference((cur) => (cur === ref ? cur : ref));
  }, []);

  const reset = useCallback(() => {
    setReference(null);
    setStatus(null);
    setMessages([]);
    setError(null);
    lastId.current = 0;
  }, []);

  /** Sends to the agent; returns false if it couldn't (the caller shows the error). */
  const send = useCallback(async (text: string) => {
    if (!reference) return false;
    try {
      const res = await fetch("/api/handoff", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ref: reference, text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      merge([data.message]);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }, [reference, merge]);

  return { reference, status, language, messages, error, live: status === "in_progress", start, reset, send };
}

export const HANDOFF_TEXT = {
  es: {
    waiting: "Te estamos conectando con un agente de GT Bank.",
    waitingSub: "Ya tiene los detalles de tu caso; no tendrás que repetirlos. Puedes seguir escribiendo aquí mientras tanto.",
    live: "Un agente de GT Bank se unió a la conversación.",
    liveSub: "Tus mensajes ahora le llegan directamente.",
    closed: "El agente cerró la conversación.",
    closedSub: "Si necesitas algo más, escribe aquí y te ayudará el asistente.",
    agent: "Agente",
    you: "Tú",
  },
  pt: {
    waiting: "Estamos conectando você a um atendente do GT Bank.",
    waitingSub: "Ele já tem os detalhes do seu caso; você não precisará repeti-los. Pode continuar escrevendo aqui enquanto isso.",
    live: "Um atendente do GT Bank entrou na conversa.",
    liveSub: "Suas mensagens agora chegam diretamente a ele.",
    closed: "O atendente encerrou a conversa.",
    closedSub: "Se precisar de mais alguma coisa, escreva aqui e o assistente vai ajudar.",
    agent: "Atendente",
    you: "Você",
  },
} as const;
