'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { adminLoginAction, type AdminLoginState } from './actions'

const initialState: AdminLoginState = {}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-xl bg-gold py-3 font-bold text-black transition-colors hover:bg-gold-hover disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? 'Signing in…' : 'Sign in'}
    </button>
  )
}

export function LoginForm() {
  const [state, formAction] = useFormState(adminLoginAction, initialState)

  return (
    <form action={formAction} className="space-y-4">
      <input
        name="email"
        type="email"
        placeholder="admin@seed.reitools.dev"
        required
        autoFocus
        className="w-full rounded-xl border border-border-default bg-black px-4 py-3 text-white placeholder:text-white/30 focus:border-gold focus:outline-none"
      />
      <input
        name="password"
        type="password"
        placeholder="Password"
        required
        className="w-full rounded-xl border border-border-default bg-black px-4 py-3 text-white placeholder:text-white/30 focus:border-gold focus:outline-none"
      />
      <SubmitButton />
      {state.error && <p className="text-sm text-red-400">{state.error}</p>}
    </form>
  )
}
