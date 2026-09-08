"use client";

import { useEffect } from "react";
import Script from "next/script";

const CHECKOUT_FORM_URL = process.env.NEXT_PUBLIC_CHECKOUT_FORM_URL;
const FORM_ID = CHECKOUT_FORM_URL?.split("/").pop() ?? "";

export default function CheckoutModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8 bg-black/70 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full my-auto"
        style={{
          maxWidth: 600,
          background: "#141414",
          border: "1px solid rgba(245,200,66,0.3)",
          borderRadius: 20,
          padding: 32,
        }}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 text-white/40 hover:text-white transition-colors z-10"
        >
          ✕
        </button>

        {CHECKOUT_FORM_URL ? (
          <div style={{ width: "100%", height: 662, background: "#141414", borderRadius: 8 }}>
            <iframe
              src={CHECKOUT_FORM_URL}
              style={{ width: "100%", height: "100%", border: "none", borderRadius: 8 }}
              id={`inline-${FORM_ID}`}
              data-layout="{'id':'INLINE'}"
              data-trigger-type="alwaysShow"
              data-trigger-value=""
              data-activation-type="alwaysActivated"
              data-activation-value=""
              data-deactivation-type="neverDeactivate"
              data-deactivation-value=""
              data-form-name="7 Day Trial"
              data-height="662"
              data-layout-iframe-id={`inline-${FORM_ID}`}
              data-form-id={FORM_ID}
              data-cookie-consent="true"
              data-cookie-consent-provider="auto"
              title="7 Day Trial"
            />
          </div>
        ) : (
          <p className="text-white/50 text-sm text-center py-20">
            Checkout temporarily unavailable — contact support@reiblast.app
          </p>
        )}
      </div>

      {open && <Script src="https://link.msgsndr.com/js/form_embed.js" strategy="afterInteractive" />}
    </div>
  );
}
