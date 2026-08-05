import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Contact — REIblast",
  description:
    "Reach REIblast support and sales by email or phone. We respond to everything within one business day.",
  robots: { index: true, follow: true },
};

const EMAIL = "support@reiblast.app";
const PHONE_DISPLAY = "(832) 820-1980";
const PHONE_HREF = "+18328201980";

const FAQS = [
  {
    q: "How do I cancel?",
    a: (
      <>
        Log in, go to Billing, select Cancel Subscription. It is immediate and
        self-service. You keep access through the end of your paid period. Full
        details in our{" "}
        <Link
          href="/refund-policy"
          className="text-gold hover:text-gold-hover underline underline-offset-4 transition-colors"
        >
          Refund and Cancellation Policy
        </Link>
        .
      </>
    ),
  },
  {
    q: "How do I add credits?",
    a: (
      <>
        In your account portal under Billing. Credits fund messaging, calling,
        and email usage.
      </>
    ),
  },
  {
    q: "How long does A2P registration take?",
    a: (
      <>
        Typically two to three business days after submission. Registration
        requires an EIN and accurate business information.
      </>
    ),
  },
  {
    q: "I received a text I did not sign up for.",
    a: (
      <>
        Reply STOP to that message to opt out immediately and permanently. If
        you want your information removed entirely, email{" "}
        <a
          href={`mailto:${EMAIL}`}
          className="text-gold hover:text-gold-hover underline underline-offset-4 transition-colors"
        >
          {EMAIL}
        </a>{" "}
        with the phone number and we will trace it to the sending account and
        require removal. Details in Section 9 of our{" "}
        <Link
          href="/privacy"
          className="text-gold hover:text-gold-hover underline underline-offset-4 transition-colors"
        >
          Privacy Policy
        </Link>
        .
      </>
    ),
  },
];

function ContactMethods() {
  return (
    <div className="flex flex-col sm:flex-row gap-4 mb-6">
      <a
        href={`mailto:${EMAIL}`}
        className="flex-1 bg-black border border-border-default rounded-xl px-6 py-5 hover:border-gold/50 transition-colors"
      >
        <p className="text-white/40 text-xs font-bold uppercase tracking-widest mb-2">
          Email
        </p>
        <p className="text-gold text-lg font-semibold break-all">{EMAIL}</p>
      </a>
      <a
        href={`tel:${PHONE_HREF}`}
        className="flex-1 bg-black border border-border-default rounded-xl px-6 py-5 hover:border-gold/50 transition-colors"
      >
        <p className="text-white/40 text-xs font-bold uppercase tracking-widest mb-2">
          Phone
        </p>
        <p className="text-gold text-lg font-semibold">{PHONE_DISPLAY}</p>
      </a>
    </div>
  );
}

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-black">
      {/* Header */}
      <section className="py-24 px-6 text-center bg-surface">
        <p className="text-gold text-xs font-bold uppercase tracking-widest mb-4">
          CONTACT
        </p>
        <h1 className="text-5xl md:text-6xl font-extrabold text-white leading-tight mb-5">
          Contact
        </h1>
        <p className="text-white/60 text-lg leading-[1.75] max-w-xl mx-auto">
          Real people, real answers. We respond to everything within one
          business day.
        </p>
      </section>

      {/* Support */}
      <section className="py-16 px-6 border-b border-border-default">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold text-white mb-6">Support</h2>
          <ContactMethods />
          <p className="text-white/70 text-[17px] leading-[1.85] mb-5">
            Support hours: Monday through Friday, 9:00 AM to 6:00 PM Central
            Time.
          </p>
          <p className="text-white/70 text-[17px] leading-[1.85]">
            Billing questions get answered within one business day. If you think
            a charge is wrong, email us before doing anything else. We correct
            genuine errors without argument.
          </p>
        </div>
      </section>

      {/* Sales */}
      <section className="py-16 px-6 border-b border-border-default">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold text-white mb-6">Sales</h2>
          <p className="text-white/70 text-[17px] leading-[1.85] mb-6">
            Questions about plans, pricing, or whether REIblast fits how you
            work.
          </p>
          <ContactMethods />
        </div>
      </section>

      {/* Business address */}
      <section className="py-16 px-6 border-b border-border-default">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold text-white mb-6">
            Business address
          </h2>
          <address className="not-italic text-white/70 text-[17px] leading-[1.85]">
            REIblast
            <br />
            3223 Ashton Park Dr
            <br />
            Houston, TX 77082
            <br />
            United States
          </address>
        </div>
      </section>

      {/* Common questions */}
      <section className="py-16 px-6">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold text-white mb-8">
            Common questions
          </h2>
          <div className="flex flex-col gap-5">
            {FAQS.map((f) => (
              <div
                key={f.q}
                className="bg-surface border border-border-default rounded-xl p-6"
              >
                <p className="text-white font-bold text-[17px] mb-3">{f.q}</p>
                <p className="text-white/70 text-[17px] leading-[1.85]">
                  {f.a}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Entity note */}
      <section className="pb-20 px-6">
        <div className="max-w-2xl mx-auto pt-8 border-t border-border-default">
          <p className="text-white/40 text-sm">
            REIblast is a Texas limited liability company.
          </p>
        </div>
      </section>
    </div>
  );
}
