'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatConfig, ChatMessage, ChatRole, Lead, LeadFieldName, TreeOption } from './types';
import {
  EngineState,
  Step,
  startTree,
  chooseOption,
  submitCapture,
  skipCapture,
  advanceTo,
} from './tree';
import { resolveTree } from './trees';
import { SCAFFOLD_DONE_ID } from './trees/scaffold';
import { extractLead } from './extract';

const AI_FALLBACK =
  'Sorry — I’m having trouble responding right now. A specialist would be glad to help; please use the options below.';

export interface UseChat {
  mode: 'tree' | 'ai';
  messages: ChatMessage[];
  // tree mode
  options: TreeOption[];
  awaiting: 'options' | 'capture' | 'none';
  captureField: LeadFieldName | null;
  optionalCapture: boolean;
  skipLabel: string | null;
  choose: (index: number) => void;
  submit: (value: string) => void;
  skip: () => void;
  /** Current lead-so-far, for display (e.g. the consent-review summary). */
  lead: Lead;
  /** True when the current node wants the consent-review panel rendered instead of default controls. */
  awaitingConsent: boolean;
  /** Records consent (single flag covers both disclosures) and advances past the consent node. */
  confirmConsent: () => void;
  // ai mode
  composer: boolean;
  sending: boolean;
  send: (value: string) => void;
  // shared
  ended: boolean;
  showCta: boolean;
  /**
   * Post-submit lock state:
   *  - 'none'      — active conversation.
   *  - 'fresh'     — lead just logged successfully this session (State 1).
   *  - 'returning' — this browser already completed a lead in a prior visit (State 2).
   */
  completedState: 'none' | 'fresh' | 'returning';
  /** Best-effort one-shot lead log; call on close/unload. */
  flush: () => void;
}

function transcriptOf(messages: ChatMessage[]): string {
  return messages.map((m) => `${m.role === 'bot' ? 'Assistant' : 'You'}: ${m.text}`).join('\n');
}

export function useChat(config: ChatConfig): UseChat {
  const isTree = config.mode === 'tree';

  const idRef = useRef(0);
  const nextId = () => `m${idRef.current++}`;
  // Every message is created here so it carries an id + timestamp.
  const mk = (role: ChatRole, text: string, extra?: Partial<ChatMessage>): ChatMessage => ({
    id: nextId(),
    role,
    text,
    ts: Date.now(),
    ...extra,
  });

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [engine, setEngine] = useState<EngineState | null>(null);
  const [sending, setSending] = useState(false);

  // Permanent post-submit lock. Stored in localStorage, namespaced by brand, and
  // holding ONLY a completion marker (a timestamp) — never any PII.
  const completedKey = `cw_completed_${config.brandName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')}`;
  // Read once on mount: was a lead already completed on THIS browser? (State 2)
  const [returningVisitor] = useState<boolean>(() => {
    try {
      return localStorage.getItem(completedKey) != null;
    } catch {
      return false;
    }
  });
  const [completed, setCompleted] = useState(false); // became true this session (State 1)

  // Refs mirror the latest values for unload-time flushing and async sends.
  const leadRef = useRef<Lead>({});
  const messagesRef = useRef<ChatMessage[]>([]);
  const loggedRef = useRef(false);
  const smsConsentRef = useRef(false);
  const consentedAtRef = useRef<string | undefined>(undefined);
  messagesRef.current = messages;

  const markCompleted = useCallback(() => {
    setCompleted(true);
    try {
      localStorage.setItem(completedKey, String(Date.now())); // marker only — no PII
    } catch {
      /* ignore */
    }
  }, [completedKey]);

  const botLines = useCallback(
    (lines: string[]): ChatMessage[] => lines.map((text) => mk('bot', text)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  /**
   * One-shot lead log. Returns true only on a confirmed successful POST — the
   * caller uses that to set the permanent lock (never lock on failure). On
   * failure the guard is released so a later attempt (next turn / unload) can retry.
   */
  const logLead = useCallback(async (): Promise<boolean> => {
    if (loggedRef.current) return false;
    const lead = leadRef.current;
    // The reordered capture flow (name → phone → email) requires both before
    // reaching @capture's terminal step, so both are expected here.
    if (!lead.email || !lead.phone) return false;
    loggedRef.current = true; // block a concurrent double-POST while in flight
    try {
      const res = await fetch('/api/chat/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead,
          transcript: transcriptOf(messagesRef.current),
          smsConsent: smsConsentRef.current,
          consentedAt: consentedAtRef.current,
        }),
        keepalive: true,
      });
      if (!res.ok) {
        loggedRef.current = false; // let it retry
        return false;
      }
      return true;
    } catch {
      loggedRef.current = false; // let it retry
      return false;
    }
  }, []);

  // Initialize once on mount.
  useEffect(() => {
    // Returning visitor (already completed a lead) → no fresh conversation (State 2).
    if (returningVisitor) return;

    const intro: ChatMessage[] = config.welcomeMessage ? [mk('bot', config.welcomeMessage)] : [];

    if (!isTree) {
      // AI mode opens with the welcome message (no scripted greeting).
      setMessages(intro.length ? intro : [mk('bot', 'Hi! How can I help you today?')]);
      return;
    }

    const tree = resolveTree(config);
    const step = startTree(tree);
    setEngine(step.state);
    setMessages([...intro, ...botLines(step.say)]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Tree-mode transitions ----------------------------------------------

  const apply = useCallback(
    (step: Step) => {
      setMessages((prev) => {
        const added: ChatMessage[] = [];
        if (step.userText) added.push(mk('user', step.userText));
        for (const line of step.say) added.push(mk('bot', line));
        return [...prev, ...added];
      });
      if (step.accepted) {
        setEngine(step.state);
        leadRef.current = step.state.lead;
        // Lock ONLY after a confirmed successful log (State 1).
        if (step.state.done) logLead().then((ok) => ok && markCompleted());
      }
    },
    [logLead, markCompleted]
  );

  const locked = completed || returningVisitor;

  const choose = useCallback(
    (index: number) => {
      if (!engine || locked) return;
      apply(chooseOption(engine, index));
    },
    [engine, apply, locked]
  );

  const submit = useCallback(
    (value: string) => {
      if (!engine || locked) return;
      const v = value.trim();
      if (!v) return;
      apply(submitCapture(engine, v));
    },
    [engine, apply, locked]
  );

  const skip = useCallback(() => {
    if (!engine || locked) return;
    apply(skipCapture(engine));
  }, [engine, apply, locked]);

  const confirmConsent = useCallback(() => {
    if (!engine || locked) return;
    smsConsentRef.current = true;
    consentedAtRef.current = new Date().toISOString();
    apply(advanceTo(engine, SCAFFOLD_DONE_ID, engine.lead));
  }, [engine, apply, locked]);

  // --- AI-mode send -------------------------------------------------------

  const send = useCallback(
    async (value: string) => {
      const v = value.trim();
      if (!v || sending || locked) return;

      // `working` is the authoritative message list for this turn — kept in sync
      // with both state and messagesRef so the lead transcript is correct.
      const userMsg = mk('user', v);
      let working = [...messagesRef.current, userMsg];
      const commit = (arr: ChatMessage[]) => {
        working = arr;
        messagesRef.current = arr;
        setMessages(arr);
      };
      commit(working);

      // Opportunistic lead capture (email/phone). The one-shot log fires on
      // STREAM CLOSE (below), not here — so the transcript includes the reply.
      const found = extractLead(v);
      if (found.email || found.phone) {
        leadRef.current = { ...leadRef.current, ...found };
      }

      setSending(true);
      let botId: string | null = null;
      let acc = '';

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: working.map((m) => ({ role: m.role, text: m.text })),
            knowledge: config.knowledge,
            brandName: config.brandName,
            captureEmail: config.captureEmail,
            ctaPhone: config.ctaPhone,
            ctaFormHref: config.ctaFormHref,
          }),
        });

        // Rate limited — calm slow-down line, BEFORE any stream handling.
        if (res.status === 429) {
          commit([
            ...working,
            mk('bot', 'You’re sending messages a little quickly — give me a moment, then try again.'),
          ]);
          return;
        }

        // Pre-stream JSON error (500/400/502) or no body → friendly fallback.
        if (!res.ok || !res.body) {
          commit([...working, mk('bot', AI_FALLBACK)]);
          return;
        }

        // Consume the plain-text stream, growing one live assistant message.
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value: chunk } = await reader.read();
          if (done) break;
          const text = decoder.decode(chunk, { stream: true });
          if (!text) continue;
          acc += text;
          if (botId === null) {
            const botMsg = mk('bot', acc, { streaming: true });
            botId = botMsg.id;
            commit([...working, botMsg]);
          } else {
            const id = botId;
            commit(working.map((m) => (m.id === id ? { ...m, text: acc } : m)));
          }
        }
        acc += decoder.decode(); // flush any trailing bytes

        if (botId !== null) {
          const id = botId;
          commit(working.map((m) => (m.id === id ? { ...m, text: acc, streaming: false } : m)));
        }

        // Empty stream (e.g. upstream errored after open) → soft failure.
        if (!acc.trim()) {
          const id = botId;
          commit([...working.filter((m) => m.id !== id), mk('bot', AI_FALLBACK)]);
        }

        // Lead logging fires once, on stream completion, when email/phone known.
        // Lock ONLY after a confirmed successful log (State 1).
        const ok = await logLead();
        if (ok) markCompleted();
      } catch {
        // Network/stream error. Keep any real partial text (drop the cursor);
        // otherwise show the friendly fallback.
        const id = botId;
        if (id !== null && acc.trim()) {
          commit(working.map((m) => (m.id === id ? { ...m, streaming: false } : m)));
        } else {
          commit([...working.filter((m) => m.id !== id), mk('bot', AI_FALLBACK)]);
        }
      } finally {
        setSending(false);
      }
    },
    [sending, locked, config, logLead, markCompleted]
  );

  // Flush the lead on tab hide / page unload (covers partial conversations).
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') logLead();
    };
    window.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', logLead);
    return () => {
      window.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', logLead);
      logLead(); // unmount = closed
    };
  }, [logLead]);

  const node = engine ? engine.tree.nodes[engine.currentId] : null;

  return {
    mode: isTree ? 'tree' : 'ai',
    messages,
    options: node?.options ?? [],
    awaiting: engine?.awaiting ?? 'none',
    captureField: node?.capture?.field ?? null,
    optionalCapture: Boolean(node?.capture?.optional),
    skipLabel: node?.capture?.skipLabel ?? null,
    choose,
    submit,
    skip,
    lead: engine?.lead ?? {},
    awaitingConsent: Boolean(node?.consent),
    confirmConsent,
    composer: !isTree,
    sending,
    send,
    // Tree: CTA only on a terminal node. AI: escalation is always available.
    ended: isTree ? (engine?.done ?? false) : false,
    showCta: isTree ? Boolean(node?.cta) : true,
    completedState: returningVisitor ? 'returning' : completed ? 'fresh' : 'none',
    flush: logLead,
  };
}
