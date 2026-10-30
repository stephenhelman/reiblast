"use client";

import React from "react";

/** Print button (the only client piece of the statement page). */
export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="inline-flex items-center rounded-lg border border-border-default px-3 py-1.5 text-xs font-semibold text-white/70 transition-colors hover:text-white print:hidden">
      Print view
    </button>
  );
}
