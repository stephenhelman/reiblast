import { LogoFull } from "@/components/shared/Logo";

/** Page chrome shared by the tools-session page and the signed-link view, so both render the same scorecard. */
export default function ScorecardShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-8"><LogoFull size={32} /></div>
        <h1 className="text-2xl font-semibold">Campaign Scorecard</h1>
        <p className="mb-8 mt-1 text-sm text-gray">How your SMS campaigns are performing.</p>
        {children}
      </div>
    </main>
  );
}
