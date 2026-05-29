"use client";

import { useState, FormEvent } from "react";
import Link from "next/link";
import { LogoFull, LogoStacked } from "@/components/shared/Logo";
import Input from "@/components/shared/Input";
import Button from "@/components/shared/Button";
import { CORE_PRICE } from "@/lib/constants";

const FEATURES = [
  "Pre-built wholesale CRM pipeline",
  "A2P-compliant SMS + locked sequences",
  "Universal wholesale contract + e-sign",
  "Deal analyzer with MAO calculator",
  "JV deal submission network",
];

interface FormData {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
}

interface FormErrors {
  name?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
}

export default function SignupPage() {
  const [form, setForm] = useState<FormData>({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState("");

  function validate(): boolean {
    const e: FormErrors = {};
    if (!form.name.trim()) e.name = "Name is required";
    if (!form.email.trim()) e.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
      e.email = "Invalid email";
    if (!form.password) e.password = "Password is required";
    else if (form.password.length < 8) e.password = "Minimum 8 characters";
    if (form.password !== form.confirmPassword)
      e.confirmPassword = "Passwords do not match";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    setServerError("");

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          password: form.password,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setServerError(data.error ?? "Something went wrong. Please try again.");
        return;
      }

      window.location.href =
        process.env.NEXT_PUBLIC_TOOLS_URL ?? "https://tools.reiblast.app";
    } catch {
      setServerError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-black flex pt-16">
      {/* Left branding panel */}
      <div className="hidden lg:flex lg:w-1/2 flex-col bg-surface border-r border-border-default py-12 px-8">
        <div className="max-w-sm mx-auto w-full flex flex-col justify-between h-full">
          <Link href="/" className="m-auto">
            <LogoStacked size={160} />
          </Link>

          <div>
            <h2 className="text-4xl font-bold text-white mb-4 leading-tight">
              Everything you need to
              <br />
              <span className="text-gold">close more deals.</span>
            </h2>
            <p className="text-white/50 mb-10 text-lg">
              One system. One price. Everything you need from list to contract.
            </p>

            <ul className="space-y-4">
              {FEATURES.map((f) => (
                <li key={f} className="flex items-center gap-3">
                  <div className="w-5 h-5 rounded-full bg-gold/20 flex items-center justify-center shrink-0">
                    <svg
                      className="w-3 h-3 text-gold"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                  <span className="text-white/80 text-sm">{f}</span>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-white/20 text-sm mt-auto ">
            Join wholesalers already closing deals with REIblast.
          </p>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex flex-col justify-center px-6 py-12 lg:px-16">
        <div className="w-full max-w-md mx-auto">
          <div className="mb-2 lg:hidden">
            <Link href="/">
              <LogoFull size={32} />
            </Link>
          </div>
          <h1 className="text-3xl font-bold text-white mb-1 mt-8 lg:mt-0">
            Create your account
          </h1>
          <p className="text-white/50 mb-8">Get started with REIblast Core.</p>

          {serverError && (
            <div className="mb-6 bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-3 rounded-lg">
              {serverError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Full Name"
              type="text"
              placeholder="John Smith"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              error={errors.name}
              autoComplete="name"
            />
            <Input
              label="Email"
              type="email"
              placeholder="you@example.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              error={errors.email}
              autoComplete="email"
            />
            <div className="relative">
              <Input
                label="Password"
                type={showPassword ? "text" : "password"}
                placeholder="Min. 8 characters"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                error={errors.password}
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-9 text-white/40 hover:text-white/70 text-xs"
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
            <div className="relative">
              <Input
                label="Confirm Password"
                type={showConfirm ? "text" : "password"}
                placeholder="Repeat password"
                value={form.confirmPassword}
                onChange={(e) =>
                  setForm({ ...form, confirmPassword: e.target.value })
                }
                error={errors.confirmPassword}
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowConfirm(!showConfirm)}
                className="absolute right-3 top-9 text-white/40 hover:text-white/70 text-xs"
              >
                {showConfirm ? "Hide" : "Show"}
              </button>
            </div>

            {/* Order summary */}
            <div className="bg-surface border border-border-default rounded-xl p-5 mt-2">
              <p className="text-white/50 text-xs uppercase tracking-wider mb-3">
                Order Summary
              </p>
              <div className="flex items-center justify-between">
                <span className="text-white text-sm font-medium">
                  REIblast Core
                </span>
                <span className="text-gold font-bold">${CORE_PRICE}/mo</span>
              </div>
              <p className="text-white/30 text-xs mt-1">
                Recurring monthly. Cancel anytime.
              </p>
            </div>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={loading}
              className="w-full mt-2"
            >
              Create Account &amp; Subscribe
            </Button>
          </form>

          <p className="text-white/30 text-xs text-center mt-6">
            By creating an account you agree to our{" "}
            <a href="#" className="text-gold hover:underline">
              Terms of Service
            </a>{" "}
            and{" "}
            <a href="#" className="text-gold hover:underline">
              Privacy Policy
            </a>
            .
          </p>
          <p className="text-white/40 text-sm text-center mt-4">
            Already have an account?{" "}
            <Link href="/login" className="text-gold hover:underline">
              Log in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
