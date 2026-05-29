'use client'

import { useState, FormEvent } from 'react'
import Link from 'next/link'
import { signIn } from 'next-auth/react'
import { LogoFull } from '@/components/shared/Logo'
import Input from '@/components/shared/Input'
import Button from '@/components/shared/Button'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!email || !password) {
      setError('Email and password are required.')
      return
    }
    setLoading(true)
    setError('')

    const result = await signIn('credentials', {
      redirect: false,
      email,
      password,
    })

    if (result?.error) {
      setError('Invalid email or password.')
      setLoading(false)
      return
    }

    window.location.href = process.env.NEXT_PUBLIC_TOOLS_URL ?? 'https://tools.reiblast.app'
  }

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-10">
          <Link href="/">
            <LogoFull size={36} />
          </Link>
        </div>

        <div className="bg-surface border border-border-default rounded-2xl p-8">
          <h1 className="text-2xl font-bold text-white mb-1">Welcome back</h1>
          <p className="text-white/50 text-sm mb-8">Sign in to your REIblast account.</p>

          {error && (
            <div className="mb-6 bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
            <div className="relative">
              <Input
                label="Password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-9 text-white/40 hover:text-white/70 text-xs"
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>

            <div className="flex justify-end">
              <a href="#" className="text-gold text-xs hover:underline">
                Forgot password?
              </a>
            </div>

            <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full">
              Log In
            </Button>
          </form>
        </div>

        <p className="text-white/40 text-sm text-center mt-6">
          Don&apos;t have an account?{' '}
          <Link href="/signup" className="text-gold hover:underline">
            Get started
          </Link>
        </p>
      </div>
    </div>
  )
}
