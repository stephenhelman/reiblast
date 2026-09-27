import NavLinks from "@/components/admin/NavLinks";
import { adminBase } from "@/lib/admin/cookie";
import { requireOwnerOrRedirect } from "@/lib/admin/requireOwner";
import { logoutAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  await requireOwnerOrRedirect();
  const base = await adminBase();
  return (
    <>
      <header className="border-b border-border-default bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-3">
          <div className="flex flex-wrap items-center gap-6">
            <span className="text-sm font-bold text-gold">REIblast Admin</span>
            <NavLinks base={base} />
          </div>
          <form action={logoutAction}>
            <button type="submit" className="text-sm text-white/50 underline decoration-white/20 underline-offset-4 hover:text-white">Sign out</button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </>
  );
}
