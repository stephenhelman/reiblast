'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChatConfig, Lead, TemplateColors, WidgetFonts } from '@/lib/chat/types';
import { useChat } from '@/lib/chat/useChat';
import { onColor, warnLowContrast } from '@/lib/chat/theme';
import { resolveAssistantName, resolveInitials } from '@/lib/chat/identity';
import './chat.css';

// --- House-style helpers (in code, brand-agnostic) -----------------------

const TRIAL_MODAL_SEEN_KEY = 'reiblast_trial_modal_seen';
const TRIAL_MODAL_SEEN_EVENT = 'reiblast:trial-modal-seen';

function digitsToTel(phone: string): string {
  return phone.replace(/[^\d+]/g, '');
}

function fmtTime(ts?: number): string {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

function Monogram({ initials, size }: { initials: string; size: 'sm' | 'lg' }) {
  return (
    <span className={`cw-monogram cw-monogram-${size}`} aria-hidden="true">
      {initials}
    </span>
  );
}

function MessageIcon() {
  return (
    <svg className="cw-launcher-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9.5L5 20.5a1 1 0 0 1-1.7-.7V5a1 1 0 0 1 1-1z"
        fill="currentColor"
      />
    </svg>
  );
}

// --- CTA-line rendering ----------------------------------------------------
// Tree content authors a trailing " → /path" on lines meant to hand off to a
// page (see lib/chat/trees/reiblast.ts). Rendered as a real gold button
// instead of literal text — a display-layer concern only, no schema change.

const CTA_LINE_RE = /^(.*?)\s*→\s*(\/\S+)$/;

function splitCtaLine(text: string): { lead: string; href: string } | null {
  const m = text.match(CTA_LINE_RE);
  if (!m) return null;
  return { lead: m[1].trim(), href: m[2] };
}

function ctaLabelFor(href: string): string {
  if (href.startsWith('/faq')) return 'Read our FAQ →';
  if (href.startsWith('/features')) return 'See our features →';
  if (href.startsWith('/checkout')) return 'Get started →';
  return 'Learn more →';
}

// --- Root (portal + token root) ------------------------------------------

export default function ChatWidget({
  config,
  colors,
  fonts,
}: {
  config: ChatConfig;
  colors: TemplateColors;
  fonts: WidgetFonts;
}) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const openedOnce = useRef(false);

  useEffect(() => setMounted(true), []);

  const onPrimary = onColor(colors.primary);
  const onAccent = onColor(colors.accent);

  // Non-blocking, dev-visible contrast check (brand tokens vary per client).
  useEffect(() => {
    warnLowContrast(config.brandName, {
      primary: colors.primary,
      accent: colors.accent,
      text: colors.text,
      surface: colors.background,
      onPrimary,
    });
  }, [config.brandName, colors.primary, colors.accent, colors.text, colors.background, onPrimary]);

  // Return focus to the launcher when the panel closes (after it was opened).
  useEffect(() => {
    if (open) openedOnce.current = true;
    else if (openedOnce.current) launcherRef.current?.focus();
  }, [open]);

  if (!mounted || !config.enabled) return null;

  const initials = resolveInitials(config);

  return createPortal(
    <div
      className="cw-root"
      style={
        {
          '--cw-primary': colors.primary,
          '--cw-accent': colors.accent,
          '--cw-surface': colors.background,
          '--cw-text': colors.text,
          '--cw-on-primary': onPrimary,
          '--cw-on-accent': onAccent,
          '--cw-font-heading': fonts.heading,
          '--cw-font-body': fonts.body,
        } as React.CSSProperties
      }
    >
      {open ? (
        <ChatPanel config={config} initials={initials} onClose={() => setOpen(false)} />
      ) : (
        <>
          <Nudge config={config} onOpen={() => setOpen(true)} />
          <button
            ref={launcherRef}
            type="button"
            className="cw-launcher"
            aria-label={`Open chat with ${config.brandName}`}
            onClick={() => setOpen(true)}
          >
            <MessageIcon />
          </button>
        </>
      )}
    </div>,
    document.body
  );
}

// --- Proactive nudge (quiet, once per session) ---------------------------

function Nudge({ config, onOpen }: { config: ChatConfig; onOpen: () => void }) {
  const [show, setShow] = useState(false);

  const dismiss = useCallback(() => {
    setShow(false);
    try {
      sessionStorage.setItem('cw-nudge-dismissed', '1');
    } catch {
      /* ignore */
    }
  }, []);

  // Arm only once the trial modal has been dismissed this session (or was
  // already dismissed on an earlier page) — never on a bare timer, which
  // would race the modal's own appearance. See TrialPopup.tsx's dismiss().
  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = sessionStorage.getItem('cw-nudge-dismissed') === '1';
    } catch {
      /* ignore */
    }
    if (dismissed) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const arm = () => {
      if (timer) return;
      timer = setTimeout(() => setShow(true), 18000);
    };

    let trialModalSeen = false;
    try {
      trialModalSeen = sessionStorage.getItem(TRIAL_MODAL_SEEN_KEY) === '1';
    } catch {
      /* ignore */
    }
    if (trialModalSeen) {
      arm();
    } else {
      window.addEventListener(TRIAL_MODAL_SEEN_EVENT, arm);
    }

    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener(TRIAL_MODAL_SEEN_EVENT, arm);
    };
  }, []);

  // Auto-dismiss if ignored (~12s).
  useEffect(() => {
    if (!show) return;
    const t = setTimeout(dismiss, 12000);
    return () => clearTimeout(t);
  }, [show, dismiss]);

  if (!show) return null;
  const text =
    config.nudgeMessage?.trim() ||
    'Questions about REIblast? I’m here to help — no pressure.';

  return (
    <div className="cw-nudge" role="status">
      <button
        type="button"
        className="cw-nudge-body"
        onClick={() => {
          dismiss();
          onOpen();
        }}
      >
        {text}
      </button>
      <button type="button" className="cw-nudge-close" aria-label="Dismiss" onClick={dismiss}>
        ×
      </button>
    </div>
  );
}

// --- Consent review --------------------------------------------------------

const TERMS_URL = 'https://www.leadconnectorhq.com/terms2';
const PRIVACY_URL = 'https://www.leadconnectorhq.com/privacy-policy';

function ConsentLinks() {
  return (
    <>
      See{' '}
      <a href={TERMS_URL} target="_blank" rel="noopener noreferrer">
        terms
      </a>{' '}
      and{' '}
      <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">
        privacy policy
      </a>
      .
    </>
  );
}

function ConsentReview({ lead, onConfirm }: { lead: Lead; onConfirm: () => void }) {
  const [informational, setInformational] = useState(false);
  const [promotional, setPromotional] = useState(false);
  const canSubmit = informational && promotional;

  return (
    <div className="cw-consent">
      <div className="cw-consent-summary">
        <strong>{lead.name}</strong>
        <span>{lead.phone}</span>
        <span>{lead.email}</span>
      </div>

      <label className="cw-consent-check">
        <input
          type="checkbox"
          checked={informational}
          onChange={(e) => setInformational(e.target.checked)}
        />
        <span>
          By submitting, you authorize REIblast HQ to text/call the number above for
          informational/transactional messages, possibly using automated means. Msg/data rates
          apply, msg frequency varies. Consent is not a condition of purchase. <ConsentLinks /> Text
          HELP for help and STOP to unsubscribe.
        </span>
      </label>

      <label className="cw-consent-check">
        <input
          type="checkbox"
          checked={promotional}
          onChange={(e) => setPromotional(e.target.checked)}
        />
        <span>
          By submitting, you authorize REIblast HQ to text/call the number above for promotional
          messages, possibly using automated means. Msg/data rates apply, msg frequency varies.
          Consent is not a condition of purchase. <ConsentLinks /> Text HELP for help and STOP to
          unsubscribe.
        </span>
      </label>

      <button type="button" className="cw-cta cw-cta-primary cw-consent-submit" disabled={!canSubmit} onClick={onConfirm}>
        Submit
      </button>
    </div>
  );
}

// --- Panel ---------------------------------------------------------------

function ChatPanel({
  config,
  initials,
  onClose,
}: {
  config: ChatConfig;
  initials: string;
  onClose: () => void;
}) {
  const chat = useChat(config);
  const [draft, setDraft] = useState('');

  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const assistantName = resolveAssistantName(config);
  const statusText = config.statusText?.trim() || 'Typically replies instantly';

  const close = () => {
    chat.flush();
    onClose();
  };

  // Auto-scroll to newest (fires as the streaming message grows).
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages]);

  // Focus the input when typing; else focus the panel on open.
  const wantsInput = chat.awaiting === 'capture' || chat.composer;
  useEffect(() => {
    if (wantsInput) inputRef.current?.focus();
    else panelRef.current?.focus();
  }, [wantsInput, chat.messages.length]);

  // Auto-grow the textarea up to ~3 lines.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 84)}px`;
  }, [draft]);

  const submitDraft = () => {
    const v = draft.trim();
    if (!v) return;
    if (chat.composer) chat.send(v);
    else chat.submit(v);
    setDraft('');
  };
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitDraft();
  };
  const onInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter newline.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitDraft();
    }
  };

  const inputMode: 'email' | 'tel' | 'text' =
    chat.captureField === 'email' ? 'email' : chat.captureField === 'phone' ? 'tel' : 'text';
  const autoComplete =
    chat.captureField === 'email'
      ? 'email'
      : chat.captureField === 'phone'
        ? 'tel'
        : chat.captureField === 'name'
          ? 'name'
          : 'off';

  // Focus trap: Esc closes; Tab cycles within the panel.
  const onPanelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const nodes = panelRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])'
    );
    const list = nodes ? Array.from(nodes).filter((el) => !el.hasAttribute('disabled')) : [];
    if (list.length === 0) return;
    const first = list[0];
    const last = list[list.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const showInput = chat.composer || (chat.mode === 'tree' && chat.awaiting === 'capture');
  const returning = chat.completedState === 'returning'; // State 2
  const fresh = chat.completedState === 'fresh'; // State 1

  return (
    <div
      className="cw-panel"
      role="dialog"
      aria-label={`${assistantName} chat`}
      aria-modal="false"
      tabIndex={-1}
      ref={panelRef}
      onKeyDown={onPanelKeyDown}
    >
      <div className="cw-header">
        <Monogram initials={initials} size="sm" />
        <div className="cw-headtext">
          <span className="cw-title">{assistantName}</span>
          <span className="cw-status">
            <span className="cw-status-dot" aria-hidden="true" />
            {statusText}
          </span>
        </div>
        <button type="button" className="cw-close" aria-label="Close chat" onClick={close}>
          ×
        </button>
      </div>

      {returning ? (
        // State 2 — returning visitor: no fresh bot, warm redirect to a human path.
        <div className="cw-completion cw-returning" role="status">
          <span className="cw-check" aria-hidden="true" />
          <p className="cw-completion-text">
            Looks like you’ve already reached out — the team has your details. Need help with
            something else? The quickest way is our contact form.
          </p>
          <div className="cw-completion-cta">
            {config.ctaFormHref && (
              <a className="cw-cta cw-cta-primary" href={config.ctaFormHref} onClick={close}>
                Open contact form
              </a>
            )}
            {config.ctaPhone && (
              <a className="cw-cta cw-cta-secondary" href={`tel:${digitsToTel(config.ctaPhone)}`}>
                Call {config.ctaPhone}
              </a>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="cw-messages" ref={messagesRef} aria-live="polite">
            {chat.messages.map((m, i) => {
              const prev = chat.messages[i - 1];
              const next = chat.messages[i + 1];
              const firstOfGroup = !prev || prev.role !== m.role;
              const lastOfGroup = !next || next.role !== m.role;
              const showAvatar = m.role === 'bot' && firstOfGroup;
              const showTime = lastOfGroup && Boolean(m.ts);
              const cta = m.role === 'bot' ? splitCtaLine(m.text) : null;
              return (
                <div key={m.id} className={`cw-row cw-row-${m.role}`}>
                  {m.role === 'bot' && (
                    <div className="cw-avatar-col">
                      {showAvatar && <Monogram initials={initials} size="sm" />}
                    </div>
                  )}
                  <div className="cw-bubble-wrap">
                    <div className={`cw-bubble cw-bubble-${m.role}`}>
                      {cta ? cta.lead : m.text}
                      {m.streaming && <span className="cw-cursor" aria-hidden="true" />}
                    </div>
                    {cta && (
                      <a className="cw-bubble-cta" href={cta.href}>
                        {ctaLabelFor(cta.href)}
                      </a>
                    )}
                    {showTime && <time className="cw-time">{fmtTime(m.ts)}</time>}
                  </div>
                </div>
              );
            })}

            {/* Typing indicator before the first token (avatar-aligned like a bot row). */}
            {chat.sending && !chat.messages.some((m) => m.streaming) && (
              <div className="cw-row cw-row-bot">
                <div className="cw-avatar-col">
                  <Monogram initials={initials} size="sm" />
                </div>
                <div className="cw-typing" aria-label="Assistant is typing">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}
          </div>

          {fresh ? (
            // State 1 — fresh completion: warm confirmation + gold check, no composer.
            <div className="cw-completion" role="status">
              <div className="cw-completion-head">
                <span className="cw-check" aria-hidden="true" />
                <p className="cw-completion-text">
                  You’re all set — the team will reach out within one business day.
                </p>
              </div>
              {(config.ctaPhone || config.ctaFormHref) && (
                <div className="cw-completion-cta">
                  {config.ctaPhone && (
                    <a className="cw-cta cw-cta-secondary" href={`tel:${digitsToTel(config.ctaPhone)}`}>
                      Call {config.ctaPhone}
                    </a>
                  )}
                  {config.ctaFormHref && (
                    <a className="cw-cta cw-cta-outline" href={config.ctaFormHref} onClick={close}>
                      Contact form
                    </a>
                  )}
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="cw-controls">
                {chat.awaitingConsent && (
                  <ConsentReview lead={chat.lead} onConfirm={chat.confirmConsent} />
                )}

                {!chat.awaitingConsent &&
                  chat.mode === 'tree' &&
                  chat.awaiting === 'options' &&
                  chat.options.map((opt, i) => (
                    <button
                      key={opt.label}
                      type="button"
                      className="cw-option"
                      onClick={() => chat.choose(i)}
                    >
                      {opt.label}
                    </button>
                  ))}

                {!chat.awaitingConsent && showInput && (
                  <>
                    <form className="cw-inputrow" onSubmit={onSubmit}>
                      <textarea
                        ref={inputRef}
                        className="cw-input"
                        rows={1}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={onInputKeyDown}
                        placeholder={chat.composer ? 'Type your message…' : 'Type your answer…'}
                        aria-label="Message"
                        inputMode={inputMode}
                        autoComplete={autoComplete}
                      />
                      <button
                        type="submit"
                        className="cw-send"
                        disabled={!draft.trim() || chat.sending}
                        aria-label="Send message"
                      >
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path
                            d="M12 19V5M12 5l-6 6M12 5l6 6"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    </form>
                    {chat.mode === 'tree' && chat.optionalCapture && (
                      <button type="button" className="cw-skip" onClick={chat.skip}>
                        {chat.skipLabel ?? 'Skip'}
                      </button>
                    )}
                  </>
                )}
              </div>

              {/* Quiet, always-available alternative — present from the start. */}
              {(config.ctaPhone || config.ctaFormHref) && (
                <div className="cw-cta-footer">
                  <span className="cw-cta-label">Prefer not to chat?</span>
                  {config.ctaPhone && (
                    <a className="cw-cta-link" href={`tel:${digitsToTel(config.ctaPhone)}`}>
                      Call {config.ctaPhone}
                    </a>
                  )}
                  {config.ctaFormHref && (
                    <a className="cw-cta-link" href={config.ctaFormHref} onClick={close}>
                      Contact form
                    </a>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
