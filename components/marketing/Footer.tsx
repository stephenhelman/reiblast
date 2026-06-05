import Link from "next/link";
import { LogoFull } from "../shared/Logo";

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
            href="mailto:support@mail.reiblast.app"
            className="text-white/50 hover:text-white transition-colors"
          >
            Support
          </a>
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
