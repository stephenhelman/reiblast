import Link from "next/link";
import { LogoFull } from "../shared/Logo";

const LEGAL_LINKS = [
  { href: "/terms", label: "Terms of Service" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/refund-policy", label: "Refund & Cancellation" },
  { href: "/acceptable-use", label: "Acceptable Use" },
  { href: "/contact", label: "Contact" },
];

export default function Footer() {
  return (
    <footer className="border-t border-border-default py-12 px-6">
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex flex-col items-center md:items-start gap-2">
          <LogoFull size={28} />
          <p className="text-white/30 text-sm">
            Built for wholesalers who blast
          </p>
        </div>

        <div className="flex items-center gap-8 text-sm flex-wrap justify-center md:justify-end">
          <Link
            href="/features"
            className="text-white/50 hover:text-white transition-colors"
          >
            Features
          </Link>
          <Link
            href="/pricing"
            className="text-white/50 hover:text-white transition-colors"
          >
            Pricing
          </Link>
          <Link
            href="/about"
            className="text-white/50 hover:text-white transition-colors"
          >
            About
          </Link>
          <a
            href="https://app.reiblast.app"
            target="_blank"
            rel="noreferrer"
            className="text-white/50 hover:text-white transition-colors"
          >
            Login
          </a>
          <a
            href="mailto:support@reiblast.app"
            className="text-white/50 hover:text-white transition-colors"
          >
            Support
          </a>
        </div>
      </div>

      {/* Legal */}
      <div className="max-w-6xl mx-auto mt-10 pt-8 border-t border-border-default">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-8">
          <div>
            <p className="text-white/40 text-xs font-bold uppercase tracking-widest mb-4">
              Legal
            </p>
            <div className="flex flex-col gap-2.5 text-sm">
              {LEGAL_LINKS.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="text-white/50 hover:text-white transition-colors"
                >
                  {l.label}
                </Link>
              ))}
            </div>
          </div>

          <address className="not-italic text-white/40 text-sm leading-[1.9] md:text-right">
            REIblast
            <br />
            3223 Ashton Park Dr, Houston, TX 77082
            <br />
            <a
              href="tel:+18328201980"
              className="hover:text-white transition-colors"
            >
              (832) 820-1980
            </a>{" "}
            ·{" "}
            <a
              href="mailto:support@reiblast.app"
              className="hover:text-white transition-colors"
            >
              support@reiblast.app
            </a>
          </address>
        </div>
      </div>

      <div className="max-w-6xl mx-auto mt-8 pt-6 border-t border-border-default">
        <p className="text-white/20 text-xs text-center">
          © {new Date().getFullYear()} REIblast. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
