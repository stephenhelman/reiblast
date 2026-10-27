"use client";

import { useState } from "react";
import CheckoutModal from "@/components/marketing/CheckoutModal";

export default function FoundersCheckout({
  formUrl,
  label = "Start your 14-day free trial",
}: {
  formUrl: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="bg-gold text-black font-bold text-lg px-8 sm:px-10 py-4 rounded-xl hover:bg-gold-hover transition-colors"
      >
        {label} →
      </button>

      <CheckoutModal
        open={open}
        onClose={() => setOpen(false)}
        formUrl={formUrl}
        formName="Founder 14 Day Trial"
        formHeight={635}
      />
    </>
  );
}
