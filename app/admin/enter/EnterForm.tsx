"use client";

import { useFormState, useFormStatus } from "react-dom";
import { CodeInput } from "@/components/admin/ui";
import { resendEntryAction, verifyEntryAction, type ResendState, type VerifyState } from "./actions";

const v0: VerifyState = {};
const r0: ResendState = {};

function Submit({ label, pendingLabel, primary }: { label: string; pendingLabel: string; primary?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={primary ? "w-full rounded-xl bg-gold py-3 font-bold text-black transition-colors hover:bg-gold-hover disabled:opacity-50" : "text-sm text-white/50 underline decoration-white/20 underline-offset-4 hover:text-white disabled:opacity-50"}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

export function EnterForm({ locationId }: { locationId: string }) {
  const [verify, verifyAction] = useFormState(verifyEntryAction, v0);
  const [resend, resendAction] = useFormState(resendEntryAction, r0);
  return (
    <div>
      <form action={verifyAction} className="space-y-4">
        <input type="hidden" name="locationId" value={locationId} />
        <CodeInput name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} placeholder="6-digit code" required autoFocus />
        <Submit primary label="Verify" pendingLabel="Verifying…" />
      </form>
      {verify.error && <p className="mt-4 text-sm text-red-400">{verify.error}</p>}
      <form action={resendAction} className="mt-6">
        <input type="hidden" name="locationId" value={locationId} />
        <Submit label="Resend code" pendingLabel="Sending…" />
      </form>
      {resend.message && <p className="mt-3 text-sm text-white/50">{resend.message}</p>}
      {resend.error && <p className="mt-3 text-sm text-red-400">{resend.error}</p>}
    </div>
  );
}
