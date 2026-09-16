"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Button from "@/components/shared/Button";

const DISMISS_KEY = "trial-popup-dismissed";
const TRIAL_MODAL_SEEN_KEY = "reiblast_trial_modal_seen";
const TRIAL_MODAL_SEEN_EVENT = "reiblast:trial-modal-seen";

export default function TrialPopup() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alreadyDismissed = false;
    try {
      alreadyDismissed = localStorage.getItem(DISMISS_KEY) === "true";
    } catch {
      // localStorage unavailable (private browsing, etc.) — just show it once.
    }
    if (alreadyDismissed) return;

    const timer = setTimeout(() => setOpen(true), 5000);
    return () => clearTimeout(timer);
  }, []);

  const dismiss = () => {
    setOpen(false);
    try {
      localStorage.setItem(DISMISS_KEY, "true");
    } catch {
      // ignore
    }
    // Arms the chat widget's nudge (see ChatWidget.tsx's Nudge component) —
    // it must not appear until this modal has had its turn.
    try {
      sessionStorage.setItem(TRIAL_MODAL_SEEN_KEY, "1");
    } catch {
      // ignore
    }
    window.dispatchEvent(new Event(TRIAL_MODAL_SEEN_EVENT));
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-6 bg-black/70 backdrop-blur-sm"
      onClick={dismiss}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full text-center"
        style={{
          maxWidth: 440,
          background: "#141414",
          border: "1px solid rgba(245,200,66,0.3)",
          borderRadius: 20,
          padding: 40,
        }}
      >
        <button
          onClick={dismiss}
          aria-label="Close"
          className="absolute top-4 right-4 text-white/40 hover:text-white transition-colors"
        >
          ✕
        </button>

        <p className="text-gold text-xs font-bold uppercase tracking-widest mb-3">
          Limited Time
        </p>
        <h2 className="text-white text-3xl font-extrabold mb-3">
          Try REIblast Free for a Week
        </h2>
        <p className="text-white/60 text-base mb-8 leading-relaxed">
          Get full access to the pipeline, sequences, and contracts for 7
          days. Just $57/mo after. Cancel anytime.
        </p>

        <Link href="/checkout" onClick={dismiss}>
          <Button variant="primary" size="lg" className="w-full">
            Get Started Free →
          </Button>
        </Link>
      </div>
    </div>
  );
}
