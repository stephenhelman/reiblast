"use client";

import { useEffect } from "react";

/** Opens the browser print dialog once the page has rendered (used by the statement print route with ?autoprint=1). */
export default function AutoPrint() {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, []);
  return null;
}
