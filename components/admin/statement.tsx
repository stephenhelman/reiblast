import React from "react";

/** Opens the dedicated print document (not a print-styled dashboard) in a new tab; ?autoprint=1 opens the print dialog there. */
export function PrintButton({ href }: { href: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-lg border border-border-default px-3 py-1.5 text-xs font-semibold text-white/70 transition-colors hover:text-white print:hidden">
      Print view
    </a>
  );
}
