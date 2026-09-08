"use client";

import { useState } from "react";
import CheckoutModal from "@/components/marketing/CheckoutModal";

export default function AriSpecialOffer({ formUrl }: { formUrl?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="bg-gold text-black font-bold text-lg px-10 py-4 rounded-xl hover:bg-gold-hover transition-colors"
      >
        Claim My Offer →
      </button>

      <CheckoutModal
        open={open}
        onClose={() => setOpen(false)}
        formUrl={formUrl}
        formName="30 Day Trial"
        formHeight={635}
      />
    </>
  );
}
