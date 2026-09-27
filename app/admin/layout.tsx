import type { Metadata } from "next";
import { FOOTER_NOTE } from "@/lib/admin/format";

export const metadata: Metadata = {
  title: "REIblast Admin",
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-black text-white">
      <div className="flex-1">{children}</div>
      <footer className="border-t border-border-default px-6 py-4 text-center text-xs text-white/40">{FOOTER_NOTE}</footer>
    </div>
  );
}
