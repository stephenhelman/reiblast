// Admin is a gated tools-app surface, desktop-only — no responsive/tablet
// treatment. No prior launcher/store gate exists in this codebase to copy
// (checked); this is new markup built consistent with the dark/gold tokens.
export default function DesktopOnlyGate({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="hidden min-h-screen md:block">{children}</div>
      <div className="flex min-h-screen items-center justify-center bg-black px-6 md:hidden">
        <div className="w-full max-w-sm rounded-2xl border border-border-default bg-surface p-8 text-center">
          <h1 className="mb-2 text-xl font-bold text-white">Open on a computer</h1>
          <p className="text-sm leading-relaxed text-white/50">
            The admin dashboard is a desktop-only surface — reopen this link on a larger screen.
          </p>
        </div>
      </div>
    </>
  )
}
