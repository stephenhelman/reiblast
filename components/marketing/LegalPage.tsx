import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Shared layout + typographic primitives for the legal documents
 * (/terms, /privacy, /refund-policy, /acceptable-use).
 *
 * Uses the existing marketing tokens only — gold, surface, border-default.
 */

export function LegalPage({
  title,
  lastUpdated,
  children,
}: {
  title: string;
  lastUpdated: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-black">
      <article className="mx-auto w-full max-w-[68ch] px-6 pt-32 pb-24">
        <p className="text-gold text-xs font-bold uppercase tracking-widest mb-4">
          LEGAL
        </p>
        <h1 className="text-4xl md:text-5xl font-extrabold text-white leading-tight">
          {title}
        </h1>
        <p className="mt-5 text-white/50 text-sm">
          Last updated: {lastUpdated}
        </p>
        <div className="mt-10">{children}</div>
      </article>
    </div>
  );
}

export function H2({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-2xl font-bold text-white mt-12 mb-4 leading-snug">
      {children}
    </h2>
  );
}

/** A standalone bold line inside a section (e.g. "Messaging and calling violations"). */
export function SubHead({ children }: { children: ReactNode }) {
  return (
    <p className="text-white font-semibold text-[17px] mt-8 mb-3">{children}</p>
  );
}

export function P({ children }: { children: ReactNode }) {
  return (
    <p className="text-white/70 text-[17px] leading-[1.85] mb-5">{children}</p>
  );
}

export function Strong({ children }: { children: ReactNode }) {
  return <strong className="text-white font-semibold">{children}</strong>;
}

export function UL({ children }: { children: ReactNode }) {
  return (
    <ul className="list-disc pl-6 mb-5 space-y-2 marker:text-gold/60">
      {children}
    </ul>
  );
}

export function OL({ children }: { children: ReactNode }) {
  return (
    <ol className="list-decimal pl-6 mb-5 space-y-3 marker:text-gold/60">
      {children}
    </ol>
  );
}

export function LI({ children }: { children: ReactNode }) {
  return (
    <li className="text-white/70 text-[17px] leading-[1.85] pl-1">
      {children}
    </li>
  );
}

export function Hr() {
  return <hr className="my-10 border-t border-border-default" />;
}

const linkClass =
  "text-gold underline underline-offset-4 hover:text-gold-hover transition-colors";

/** Internal cross-link to another policy route. */
export function PolicyLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={linkClass}>
      {children}
    </Link>
  );
}

export function Mail({ address }: { address: string }) {
  return (
    <a href={`mailto:${address}`} className={linkClass}>
      {address}
    </a>
  );
}

export function Tel({ display, number }: { display: string; number: string }) {
  return (
    <a href={`tel:${number}`} className={linkClass}>
      {display}
    </a>
  );
}

/** The entity + address block that closes each legal document. */
export function LegalContact() {
  return (
    <address className="not-italic text-white/70 text-[17px] leading-[1.85]">
      REIblast
      <br />
      3223 Ashton Park Dr
      <br />
      Houston, TX 77082
      <br />
      <Tel display="(832) 820-1980" number="+18328201980" />
      <br />
      <Mail address="support@reiblast.app" />
    </address>
  );
}
