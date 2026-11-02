"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; external?: boolean };

export default function MobileMenu({ items }: { items: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <div className="md:hidden flex items-center gap-2">
      <Link
        href="/checkout"
        className="bg-gold text-black font-semibold text-sm px-4 py-2 rounded-lg"
      >
        Get Started
      </Link>
      <button
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls="mobile-menu"
        onClick={() => setOpen((o) => !o)}
        className="h-11 w-11 flex items-center justify-center text-white/80 hover:text-white"
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          {open ? (
            <path d="M6 6l12 12M18 6L6 18" />
          ) : (
            <path d="M4 7h16M4 12h16M4 17h16" />
          )}
        </svg>
      </button>
      {open &&
        createPortal(
          <div
            id="mobile-menu"
            className="fixed top-16 inset-x-0 bottom-0 z-[2147483600] bg-black/95 backdrop-blur-sm border-t border-border-default px-6 py-4 overflow-y-auto"
          >
            <ul className="flex flex-col">
              {items.map((item) => (
                <li key={item.href} className="border-b border-border-default">
                  {item.external ? (
                    <a
                      href={item.href}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center min-h-[52px] text-lg text-white"
                    >
                      {item.label}
                    </a>
                  ) : (
                    <Link
                      href={item.href}
                      className="flex items-center min-h-[52px] text-lg text-white/80 hover:text-white"
                    >
                      {item.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}
