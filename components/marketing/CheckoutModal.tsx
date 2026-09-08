"use client";

import { useEffect } from "react";
import Script from "next/script";

const DEFAULT_FORM_URL = process.env.NEXT_PUBLIC_CHECKOUT_FORM_URL;

export default function CheckoutModal({
  open,
  onClose,
  formUrl = DEFAULT_FORM_URL,
  formName = "7 Day Trial",
  formHeight = 662,
}: {
  open: boolean;
  onClose: () => void;
  formUrl?: string;
  formName?: string;
  formHeight?: number;
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

  const formId = formUrl?.split("/").pop() ?? "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8 bg-black/70 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative my-auto flex flex-col"
        style={{
          width: "clamp(340px, 55vw, 760px)",
          height: "min(600px, 80vh)",
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

        {formUrl ? (
          <div
            className="flex-1 min-h-0 checkout-modal-scroll"
            style={{ width: "100%", background: "#141414", borderRadius: 8, overflowY: "auto" }}
          >
            <iframe
              src={formUrl}
              scrolling="no"
              style={{ width: "100%", height: 900, border: "none", borderRadius: 8, display: "block" }}
              id={`inline-${formId}`}
              data-layout="{'id':'INLINE'}"
              data-trigger-type="alwaysShow"
              data-trigger-value=""
              data-activation-type="alwaysActivated"
              data-activation-value=""
              data-deactivation-type="neverDeactivate"
              data-deactivation-value=""
              data-form-name={formName}
              data-height={formHeight}
              data-layout-iframe-id={`inline-${formId}`}
              data-form-id={formId}
              data-cookie-consent="true"
              data-cookie-consent-provider="auto"
              title={formName}
            />
          </div>
        ) : (
          <p className="text-white/50 text-sm text-center py-20">
            Checkout temporarily unavailable — contact support@reiblast.app
          </p>
        )}
      </div>

      {open && <Script src="https://link.msgsndr.com/js/form_embed.js" strategy="afterInteractive" />}

      <style jsx>{`
        .checkout-modal-scroll {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .checkout-modal-scroll::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </div>
  );
}
