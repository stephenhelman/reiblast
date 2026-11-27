"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// /welcome is for people who have already signed up and has one primary action (booking), so no checkout button there.
// Both forms are listed because middleware rewrites /welcome → /marketing/welcome: the server render can see the rewritten
// path while the browser sees the public one, and the two must agree.
const HIDDEN_ON = ["/welcome", "/marketing/welcome"];

export default function GetStartedLink({ className }: { className: string }) {
  const pathname = usePathname();
  if (HIDDEN_ON.includes(pathname)) return null;
  return (
    <Link href="/checkout" className={className}>
      Get Started
    </Link>
  );
}
