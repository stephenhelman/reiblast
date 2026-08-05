import type { Metadata } from "next";
import {
  H2,
  Hr,
  LegalContact,
  LegalPage,
  Mail,
  P,
  PolicyLink,
  Strong,
} from "@/components/marketing/LegalPage";

export const metadata: Metadata = {
  title: "Terms of Service — REIblast",
  description:
    "The terms governing your access to and use of the REIblast platform, including subscriptions, billing, cancellation, acceptable use, and liability.",
  robots: { index: true, follow: true },
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" lastUpdated="August 5, 2026">
      <P>
        These Terms of Service (&quot;Terms&quot;) govern your access to and use
        of the REIblast platform, operated by REIblast, a Texas limited
        liability company (&quot;REIblast,&quot; &quot;we,&quot; &quot;us,&quot;
        or &quot;our&quot;). By creating an account, subscribing, or using the
        platform, you agree to these Terms.
      </P>
      <P>If you do not agree, do not use the platform.</P>

      <Hr />

      <H2>1. The Service</H2>
      <P>
        REIblast is a software-as-a-service platform for real estate investors
        and wholesalers. Subscribers receive access to a hosted customer
        relationship management system, prebuilt automation and messaging
        templates, contract generation and electronic signature tooling, lead
        processing utilities, and deal analysis tools.
      </P>
      <P>
        We provide software. We do not provide real estate services, legal
        advice, financial advice, or investment advice. Nothing produced by or
        through the platform constitutes any of those things.
      </P>

      <H2>2. Eligibility</H2>
      <P>
        You must be at least 18 years old and able to enter into a binding
        contract. If you use the platform on behalf of a business, you represent
        that you have authority to bind that business to these Terms.
      </P>

      <H2>3. Accounts</H2>
      <P>
        You are responsible for maintaining the confidentiality of your login
        credentials and for all activity that occurs under your account. Notify
        us immediately at <Mail address="support@reiblast.app" /> if you believe
        your account has been accessed without authorization.
      </P>
      <P>
        Accounts are for a single subscriber. You may not share, resell,
        sublicense, or provide access to your account to third parties without
        our written permission.
      </P>

      <H2>4. Subscriptions and Billing</H2>
      <P>
        <Strong>Plans and pricing.</Strong> Subscription plans and current
        pricing are listed at{" "}
        <PolicyLink href="/pricing">reiblast.app/pricing</PolicyLink>. We may
        change pricing with at least 30 days notice to active subscribers. Price
        changes take effect at your next renewal.
      </P>
      <P>
        <Strong>Billing cycle.</Strong> Subscriptions bill monthly in advance on
        the date you subscribe and automatically renew each month until
        cancelled. By subscribing, you authorize us and our payment processors
        to charge your payment method on a recurring basis.
      </P>
      <P>
        <Strong>What is included.</Strong> Your subscription includes platform
        access and the number of phone numbers specified in your plan.
        Messaging, calling, and email usage is billed separately as described
        below.
      </P>
      <P>
        <Strong>Usage charges.</Strong> Sending text messages, placing calls,
        and sending emails consumes usage credits. Usage is metered at the rates
        published in your account. You are responsible for maintaining a
        sufficient credit balance. When your balance is exhausted, sending and
        calling functions will stop until you purchase additional credits. Other
        platform functions remain available.
      </P>
      <P>
        <Strong>Failed payments.</Strong> If a payment fails, we will attempt
        the charge up to three times. After the third failed attempt, we will
        stop attempting to charge your payment method, disable usage billing on
        your account, and suspend platform access until payment is resolved. We
        will notify you by email before suspension.
      </P>
      <P>
        <Strong>Reactivation.</Strong> Suspended accounts may be reactivated by
        resolving the outstanding balance. Account data is retained for 30 days
        following suspension. After 30 days, we may permanently delete the
        account and its data.
      </P>
      <P>
        <Strong>Taxes.</Strong> Prices do not include taxes. You are responsible
        for any applicable sales, use, or similar taxes.
      </P>

      <H2>5. Cancellation</H2>
      <P>
        You may cancel at any time through your account portal or by emailing{" "}
        <Mail address="support@reiblast.app" />.
      </P>
      <P>
        Cancellation takes effect at the end of your current billing period. You
        retain access through the end of the period you have paid for. We do not
        prorate partial months.
      </P>
      <P>
        Cancelling your subscription does not automatically refund unused
        credits. See our{" "}
        <PolicyLink href="/refund-policy">
          Refund and Cancellation Policy
        </PolicyLink>{" "}
        for details.
      </P>

      <H2>6. Third Party Services</H2>
      <P>
        The platform is built on and integrates with third party services,
        including GoHighLevel, Twilio, and payment processors. Your use of the
        platform is also subject to their terms. We are not responsible for
        outages, changes, price increases, or discontinuation of third party
        services, and we may modify or discontinue integrations as those
        services change.
      </P>

      <H2>7. Acceptable Use</H2>
      <P>
        Your use of the platform, and particularly your use of messaging,
        calling, and email features, is governed by our{" "}
        <PolicyLink href="/acceptable-use">Acceptable Use Policy</PolicyLink>,
        which is incorporated into these Terms by reference.
      </P>
      <P>
        You are solely responsible for the content you send, the recipients you
        send to, and your compliance with all applicable laws governing that
        communication, including the Telephone Consumer Protection Act, state
        telemarketing and messaging laws, Do Not Call registry requirements,
        CAN-SPAM, and carrier messaging rules.
      </P>
      <P>
        We may suspend or terminate your account immediately and without refund
        for violations of the{" "}
        <PolicyLink href="/acceptable-use">Acceptable Use Policy</PolicyLink>.
      </P>

      <H2>8. Your Data</H2>
      <P>
        You retain ownership of the contact records, lists, message content, and
        other data you upload to or generate on the platform (&quot;Your
        Data&quot;).
      </P>
      <P>
        You grant us a license to host, process, transmit, and display Your Data
        as necessary to operate the platform and provide the service.
      </P>
      <P>
        You represent and warrant that you have the legal right to upload and
        use Your Data, including any consent required to contact the individuals
        in it.
      </P>
      <P>
        Our handling of personal information is described in our{" "}
        <PolicyLink href="/privacy">Privacy Policy</PolicyLink>.
      </P>

      <H2>9. Our Intellectual Property</H2>
      <P>
        The platform, including its software, templates, workflows, automations,
        documentation, and branding, is our property or licensed to us. Your
        subscription grants you a limited, non-exclusive, non-transferable right
        to use the platform during your subscription term. It does not transfer
        ownership of anything.
      </P>
      <P>
        You may not copy, reverse engineer, resell, white label, or create
        derivative works from the platform or its templates without our written
        permission.
      </P>

      <H2>10. Service Availability</H2>
      <P>
        We aim to keep the platform available and functioning but do not
        guarantee uninterrupted service. The platform depends on third party
        infrastructure that we do not control. We may perform maintenance,
        deploy updates, and modify features at any time.
      </P>
      <P>
        We do not guarantee message delivery. Carriers filter, block, and delay
        messages for reasons outside our control, including your sender
        reputation and campaign registration status.
      </P>

      <H2>11. Disclaimers</H2>
      <P>
        THE PLATFORM IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot;
        WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING WARRANTIES
        OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND
        NON-INFRINGEMENT.
      </P>
      <P>
        We do not warrant that the platform will meet your requirements, that it
        will generate leads, deals, or revenue, or that results obtained from
        its use will be accurate or reliable. Deal analysis outputs, comparable
        property data, and AI generated content are estimates provided for
        informational purposes and should not be relied upon as the sole basis
        for any transaction.
      </P>

      <H2>12. Limitation of Liability</H2>
      <P>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE WILL NOT BE LIABLE FOR ANY
        INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR
        FOR ANY LOSS OF PROFITS, REVENUE, DATA, OR BUSINESS OPPORTUNITY, ARISING
        OUT OF OR RELATED TO YOUR USE OF THE PLATFORM.
      </P>
      <P>
        OUR TOTAL AGGREGATE LIABILITY FOR ANY CLAIM ARISING OUT OF OR RELATED TO
        THESE TERMS OR THE PLATFORM WILL NOT EXCEED THE AMOUNT YOU PAID US IN
        THE THREE MONTHS PRECEDING THE EVENT GIVING RISE TO THE CLAIM.
      </P>

      <H2>13. Indemnification</H2>
      <P>
        You agree to indemnify, defend, and hold harmless REIblast, its members,
        officers, and agents from any claims, damages, penalties, fines, losses,
        liabilities, and expenses, including reasonable attorneys&apos; fees,
        arising out of or related to your use of the platform, the content you
        transmit through it, your violation of these Terms or the{" "}
        <PolicyLink href="/acceptable-use">Acceptable Use Policy</PolicyLink>,
        or your violation of any law, including the Telephone Consumer
        Protection Act and state messaging or telemarketing laws.
      </P>
      <P>This provision survives termination of your account.</P>

      <H2>14. Suspension and Termination</H2>
      <P>
        We may suspend or terminate your account immediately if you violate
        these Terms or the{" "}
        <PolicyLink href="/acceptable-use">Acceptable Use Policy</PolicyLink>,
        if your account creates legal, regulatory, or carrier risk to us or
        other subscribers, or if required by law or by a third party service we
        depend on.
      </P>
      <P>You may terminate at any time by cancelling your subscription.</P>
      <P>
        On termination, your right to use the platform ends immediately. We will
        make Your Data available for export for 30 days following termination,
        after which we may delete it.
      </P>

      <H2>15. Changes to These Terms</H2>
      <P>
        We may update these Terms. Material changes will be communicated by
        email or in-platform notice at least 30 days before taking effect.
        Continued use after changes take effect constitutes acceptance.
      </P>

      <H2>16. Governing Law and Disputes</H2>
      <P>
        These Terms are governed by the laws of the State of Texas, without
        regard to conflict of law principles.
      </P>
      <P>
        Any dispute arising out of or related to these Terms or the platform
        will be brought exclusively in the state or federal courts located in
        Harris County, Texas, and you consent to the jurisdiction of those
        courts.
      </P>

      <H2>17. Miscellaneous</H2>
      <P>
        If any provision of these Terms is found unenforceable, the remaining
        provisions remain in effect. Our failure to enforce a provision is not a
        waiver of it. You may not assign these Terms without our written
        consent. These Terms, together with the{" "}
        <PolicyLink href="/privacy">Privacy Policy</PolicyLink>,{" "}
        <PolicyLink href="/refund-policy">
          Refund and Cancellation Policy
        </PolicyLink>
        , and{" "}
        <PolicyLink href="/acceptable-use">Acceptable Use Policy</PolicyLink>,
        constitute the entire agreement between you and us regarding the
        platform.
      </P>

      <H2>18. Contact</H2>
      <LegalContact />
    </LegalPage>
  );
}
