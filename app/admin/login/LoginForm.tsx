"use client";

import { useFormState, useFormStatus } from "react-dom";
import { CodeInput } from "@/components/admin/ui";
import { fallbackLoginAction, type LoginState } from "./actions";

const s0: LoginState = {};

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="w-full rounded-xl bg-gold py-3 font-bold text-black transition-colors hover:bg-gold-hover disabled:opacity-50">
      {pending ? "Checking…" : "Sign in"}
    </button>
  );
}

export function LoginForm() {
  const [state, action] = useFormState(fallbackLoginAction, s0);
  return (
    <div>
      <form action={action} className="space-y-4">
        <CodeInput name="code" autoComplete="one-time-code" autoCapitalize="characters" placeholder="Authenticator or backup code" required autoFocus />
        <Submit />
      </form>
      {state.error && <p className="mt-4 text-sm text-red-400">{state.error}</p>}
    </div>
  );
}
