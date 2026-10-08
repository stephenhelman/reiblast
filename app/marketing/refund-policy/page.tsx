import type { Metadata } from "next";
import { CORE_PRICE, SETUP_FEE, TRIAL_LENGTH_DAYS } from "@/lib/pricing";
import {
  H2,
  Hr,
  LI,
  LegalContact,
  LegalPage,
  Mail,
  OL,
  P,
  PolicyLink,
  Strong,
} from "@/components/marketing/LegalPage";

export const metadata: Metadata = {
  title: "Refund and Cancellation Policy — REIblast",
  description:
    "How to cancel your REIblast subscription, the free trial, and which charges are non-refundable.",
  robots: { index: true, follow: true },
};

export default function RefundPolicyPage() {
  return (
    <LegalPage
      title="Refund and Cancellation Policy"
      lastUpdated="October 7, 2026"
    >
      <P>
        This policy explains how to cancel your REIblast subscription and when
        refunds are available. It forms part of our{" "}
        <PolicyLink href="/terms">Terms of Service</PolicyLink>.
      </P>
      <P>
        We have written this to be specific rather than vague, so you know
        exactly what to expect before you subscribe.
      </P>

      <Hr />

      <H2>How to cancel</H2>
      <P>You can cancel your subscription at any time in one of two ways:</P>
      <OL>
        <LI>
          <Strong>In your account portal.</Strong> Log in, go to Billing, and
          select Cancel Subscription. Cancellation is immediate and
          self-service. You do not need to contact us or wait for approval.
        </LI>
        <LI>
          <Strong>By email.</Strong> Send a cancellation request from your
          account email address to <Mail address="support@reiblast.app" />. We
          will process it within one business day and confirm by email.
        </LI>
      </OL>
      <P>
        You do not need to give a reason, and we will not require a phone call
        to cancel.
      </P>

      <H2>What happens when you cancel</H2>
      <P>
        Cancellation takes effect at the end of your current billing period. You
        keep full access to the platform through the end of the period you have
        already paid for.
      </P>
      <P>
        Your subscription will not renew and your payment method will not be
        charged again.
      </P>
      <P>
        <Strong>We do not prorate partial months.</Strong> If you cancel on day
        5 of a 30 day billing period, you retain access for the remaining 25
        days and are not refunded for them.
      </P>

      <H2>The {TRIAL_LENGTH_DAYS}-day free trial</H2>
      <P>
        Your {TRIAL_LENGTH_DAYS}-day free trial is your risk-free evaluation
        period. If you cancel before the trial ends, you will not be charged
        the ${CORE_PRICE}/mo subscription. The one-time ${SETUP_FEE} setup fee
        is charged when you sign up, before the trial begins, and is not
        refunded on cancellation (see below).
      </P>
      <P>
        There is no additional refund period after the trial. Once the first
        subscription payment is charged, it is final.
      </P>

      <H2>What is not refundable</H2>
      <P>
        The following charges are final and non-refundable in all
        circumstances:
      </P>
      <P>
        <Strong>Usage credits, whether used or unused.</Strong> Credits purchase
        messaging, calling, and email capacity that we buy from carriers and
        telecom providers on your behalf at the time of purchase. That cost is
        incurred immediately and is not recoverable by us. Unused credit
        balances are not refunded on cancellation and do not convert to cash. We
        recommend purchasing credits in amounts matched to your near-term
        sending plans.
      </P>
      <P>
        <Strong>Subscription payments.</Strong> Once charged, including
        renewals and partial periods.
      </P>
      <P>
        <Strong>A2P registration and carrier compliance fees.</Strong> These are
        paid to carriers and registration authorities at the time of submission
        and cannot be recovered, including where a registration is rejected by
        the carrier.
      </P>
      <P>
        <Strong>Phone number fees.</Strong> Numbers are provisioned and billed
        by our telecom providers for the full period.
      </P>
      <P>
        <Strong>The ${SETUP_FEE} setup fee and other one-time setup and
        done-for-you service fees.</Strong> Account provisioning and
        configuration work begins immediately upon signup, so these fees are
        non-refundable once you have signed up.
      </P>

      <H2>Accounts suspended or terminated for policy violations</H2>
      <P>
        If we suspend or terminate your account for violating our{" "}
        <PolicyLink href="/terms">Terms of Service</PolicyLink> or{" "}
        <PolicyLink href="/acceptable-use">Acceptable Use Policy</PolicyLink>,
        no refund is issued for any portion of your subscription, credits, or
        fees.
      </P>

      <H2>Failed payments</H2>
      <P>
        If a payment fails, we attempt the charge up to three times. After the
        third failed attempt, we stop attempting your payment method entirely,
        disable usage billing, and suspend platform access. We notify you by
        email before suspension.
      </P>
      <P>
        Suspension is not cancellation. To fully cancel and stop future billing,
        cancel through your portal or by email.
      </P>

      <H2>Chargebacks</H2>
      <P>
        If you believe a charge is incorrect, contact us first at{" "}
        <Mail address="support@reiblast.app" />. We respond to billing questions
        within one business day and will correct genuine errors without
        argument.
      </P>
      <P>
        Filing a chargeback without contacting us may result in immediate
        account termination and forfeiture of any remaining credit balance while
        the dispute is resolved.
      </P>

      <H2>Questions</H2>
      <LegalContact />
    </LegalPage>
  );
}
