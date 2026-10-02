"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Overview" },
  { href: "/revenue", label: "Revenue" },
  { href: "/costs", label: "Costs" },
  { href: "/margin", label: "Margin" },
  { href: "/members", label: "Members" },
  { href: "/health", label: "Health" },
];

export default function NavLinks({ base }: { base: string }) {
  const pathname = usePathname() || "/";
  return (
    <nav className="flex flex-wrap gap-1">
      {ITEMS.map((i) => {
        const href = `${base}${i.href === "/" ? "" : i.href}` || "/";
        const active = i.href === "/" ? pathname === href || pathname === `${href}/` : pathname.startsWith(href);
        return (
          <Link key={i.href} href={href} className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${active ? "bg-gold/10 text-gold" : "text-white/60 hover:text-white"}`}>
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
