import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "REIblast Admin",
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-black text-white">
      <div className="flex-1">{children}</div>
    </div>
  );
}
