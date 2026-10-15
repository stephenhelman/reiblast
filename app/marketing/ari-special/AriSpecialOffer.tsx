"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import CheckoutModal from "@/components/marketing/CheckoutModal";
import type { AriTier } from "@/lib/ariPromo";
import { redeemAriCode } from "./actions";

export default function AriSpecialOffer({
  initialTier,
  initialCode,
}: {
  initialTier: AriTier | null;
  initialCode: string;
}) {
  const [promptOpen, setPromptOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(!!initialTier);
  const [tier, setTier] = useState<AriTier | null>(initialTier);
  const [code, setCode] = useState(initialCode);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  // A ?promo= that didn't resolve falls back to the prompt, pre-filled.
  useEffect(() => {
    if (initialCode && !initialTier) {
      setPromptOpen(true);
      setError("That code didn't work. Check it and try again.");
    }
  }, [initialCode, initialTier]);

  useEffect(() => {
    if (promptOpen) inputRef.current?.focus();
  }, [promptOpen]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    startTransition(async () => {
      const res = await redeemAriCode(code);
      if (res.ok) {
        setTier(res.tier);
        setPromptOpen(false);
        setFormOpen(true);
      } else {
        setError(
          res.error === "rate-limited"
            ? "Too many attempts. Wait a minute and try again."
            : "That code didn't work. Check it and try again."
        );
      }
    });
  }

  return (
    <>
      <button
        onClick={() => (tier ? setFormOpen(true) : setPromptOpen(true))}
        className="bg-gold text-black font-bold text-lg px-10 py-4 rounded-xl hover:bg-gold-hover transition-colors"
      >
        Get My Discount →
      </button>

      {promptOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70 backdrop-blur-sm"
          onClick={() => setPromptOpen(false)}
        >
          <form
            onSubmit={submit}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-sm bg-[#141414] border border-gold/30 rounded-2xl p-8 text-left"
          >
            <button
              type="button"
              onClick={() => setPromptOpen(false)}
              aria-label="Close"
              className="absolute top-4 right-4 text-white/40 hover:text-white transition-colors"
            >
              ✕
            </button>
            <h2 className="text-white text-xl font-bold mb-2">Enter your promo code</h2>
            <p className="text-white/50 text-sm mb-5">
              Use the code you received from Ari.
            </p>
            <input
              ref={inputRef}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="PROMO CODE"
              className="w-full bg-black border border-white/15 rounded-lg px-4 py-3 text-white uppercase tracking-widest placeholder:text-white/25 focus:outline-none focus:border-gold"
            />
            {error && (
              <p role="alert" className="text-red-400 text-sm mt-3">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={pending || !code.trim()}
              className="w-full mt-5 bg-gold text-black font-bold py-3 rounded-xl hover:bg-gold-hover transition-colors disabled:opacity-50"
            >
              {pending ? "Checking…" : "Apply Code"}
            </button>
          </form>
        </div>
      )}

      <CheckoutModal
        open={formOpen && !!tier}
        onClose={() => setFormOpen(false)}
        formUrl={tier?.formUrl}
        formName={tier?.formName}
        formHeight={635}
      />
    </>
  );
}
