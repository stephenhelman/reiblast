"use client";

import { useState, useTransition } from "react";
import { claimStatusMessage, SOLD_OUT_MESSAGE, type ClaimUi } from "@/lib/founderOffer/copy";
import { claimAction, confirmCodeAction, startCodeAction } from "./actions";

const BUTTON = "w-full rounded-lg bg-gold text-black font-bold py-3.5 text-base disabled:opacity-60 active:scale-[0.98] transition-transform";

/** email-free flow: Claim my spot (texts a code) → code → Claim my founder slot. `startAt` is "claim" when a valid session already exists. */
export default function ClaimFlow({ token, startAt }: { token: string; startAt: "start" | "claim" }) {
  const [step, setStep] = useState<"start" | "code" | "claim" | "done">(startAt);
  const [code, setCode] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ClaimUi | null>(null);
  const [pending, run] = useTransition();

  const sendCode = () =>
    run(async () => {
      setError(null);
      const r = await startCodeAction(token);
      if (r.ok) {
        setNote(`We texted a code to the number ending in ${r.phoneLast4}.`);
        setCode("");
        setStep("code");
      } else setError(r.message);
    });

  const verify = () =>
    run(async () => {
      setError(null);
      const r = await confirmCodeAction(token, code);
      if (r.ok) setStep("claim");
      else setError(r.message);
    });

  const claim = () =>
    run(async () => {
      setError(null);
      setResult(await claimAction(token));
      setStep("done");
    });

  if (step === "done" && result) {
    const text = result.kind === "claim" ? claimStatusMessage(result) : result.kind === "sold_out" ? SOLD_OUT_MESSAGE : result.message;
    return <p role="status" className="text-white text-lg font-semibold leading-relaxed text-center">{text}</p>;
  }

  return (
    <div className="space-y-4">
      {step === "start" && (
        <>
          <p className="text-white/60 text-sm text-center">We&apos;ll text a code to the phone on your account to make sure it&apos;s you.</p>
          <button className={BUTTON} disabled={pending} onClick={sendCode}>{pending ? "Sending…" : "Claim my spot"}</button>
        </>
      )}
      {step === "code" && (
        <>
          {note && <p className="text-white/60 text-sm text-center">{note}</p>}
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            aria-label="6-digit code"
            placeholder="123456"
            className="w-full rounded-lg bg-surface border border-border-default text-white text-center text-2xl tracking-[0.4em] py-3.5 focus:outline-none focus:border-gold"
          />
          <button className={BUTTON} disabled={pending || code.length !== 6} onClick={verify}>{pending ? "Checking…" : "Verify code"}</button>
          <button className="w-full text-sm text-gray underline disabled:opacity-60" disabled={pending} onClick={sendCode}>Send a new code</button>
        </>
      )}
      {step === "claim" && (
        <>
          <p className="text-white/60 text-sm text-center">You&apos;re verified.</p>
          <button className={BUTTON} disabled={pending} onClick={claim}>{pending ? "Claiming…" : "Claim my founder slot"}</button>
        </>
      )}
      {error && <p role="alert" className="text-red-400 text-sm text-center">{error}</p>}
    </div>
  );
}
