import type { Metadata } from "next";
import {
  H2,
  Hr,
  LI,
  LegalContact,
  LegalPage,
  Mail,
  P,
  PolicyLink,
  Strong,
  UL,
} from "@/components/marketing/LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy — REIblast",
  description:
    "How REIblast collects, uses, shares, and protects personal information, including subscriber data and subscriber-uploaded contact data.",
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" lastUpdated="August 5, 2026">
      <P>
        This Privacy Policy explains how REIblast (&quot;REIblast,&quot;
        &quot;we,&quot; &quot;us&quot;) collects, uses, shares, and protects
        personal information in connection with the REIblast platform at
        reiblast.app.
      </P>

      <Hr />

      <H2>1. Two kinds of data</H2>
      <P>
        This policy covers two distinct categories, and the distinction matters.
      </P>
      <P>
        <Strong>Subscriber data</Strong> is information about you, our customer:
        your name, email, phone number, business details, billing information,
        and how you use the platform. We are the controller of this data.
      </P>
      <P>
        <Strong>Subscriber-uploaded data</Strong> is information about third
        parties that you upload to or generate in the platform, such as property
        owner contact records, phone numbers, and message history. You are the
        controller of this data. We process it on your behalf as a service
        provider, under your instructions and under our{" "}
        <PolicyLink href="/terms">Terms of Service</PolicyLink>.
      </P>
      <P>
        If you are a member of the public who received a message sent through
        our platform and you want your information removed, see Section 9.
      </P>

      <H2>2. Information we collect from subscribers</H2>
      <P>
        <Strong>You provide:</Strong> name, email address, phone number,
        business name and address, tax identification number where required for
        A2P registration, and account credentials.
      </P>
      <P>
        <Strong>Payment processors provide:</Strong> billing status, transaction
        records, and partial payment method details. We do not store full card
        numbers. Payments are processed by third party processors under their
        own privacy policies.
      </P>
      <P>
        <Strong>We collect automatically:</Strong> IP address, browser and
        device information, pages visited, features used, session timestamps,
        and error logs. We use cookies and similar technologies for
        authentication, session management, and analytics.
      </P>
      <P>
        <Strong>Platform usage:</Strong> message volume, call records, credit
        balance and consumption, campaign activity, and support communications.
      </P>

      <H2>3. How we use subscriber information</H2>
      <UL>
        <LI>To provide, operate, and maintain the platform</LI>
        <LI>To create and manage your account and sub-account</LI>
        <LI>To process payments and manage subscriptions and credits</LI>
        <LI>
          To submit A2P brand and campaign registrations to carriers and
          registration authorities on your behalf
        </LI>
        <LI>To provide customer support</LI>
        <LI>
          To send service communications, including billing notices, low balance
          alerts, and outage notifications
        </LI>
        <LI>
          To monitor for violations of our{" "}
          <PolicyLink href="/acceptable-use">Acceptable Use Policy</PolicyLink>{" "}
          and respond to carrier or regulatory complaints
        </LI>
        <LI>To improve the platform and develop features</LI>
        <LI>To comply with legal obligations and enforce our agreements</LI>
      </UL>
      <P>We do not sell subscriber personal information.</P>

      <H2>4. Subscriber-uploaded data</H2>
      <P>
        When you upload contact lists or generate contact records in the
        platform, we store, process, and transmit that data solely to provide
        the service to you.
      </P>
      <P>
        We do not use subscriber-uploaded data for our own purposes, do not sell
        it, and do not share it except as needed to deliver messages through
        telecom providers, to comply with law, or where you direct us to.
      </P>
      <P>
        You are responsible for having a lawful basis to collect and use that
        data, and for providing any notices and honoring any rights that
        individuals in it are entitled to under applicable law. This is
        described further in our{" "}
        <PolicyLink href="/acceptable-use">Acceptable Use Policy</PolicyLink>.
      </P>

      <H2>5. Who we share information with</H2>
      <P>
        <Strong>Service providers</Strong> who operate parts of the platform on
        our behalf:
      </P>
      <UL>
        <LI>GoHighLevel, for CRM infrastructure and messaging orchestration</LI>
        <LI>
          Twilio and affiliated telecom carriers, for message and call delivery
        </LI>
        <LI>Payment processors, for subscription and credit transactions</LI>
        <LI>Cloud hosting, database, and email delivery providers</LI>
        <LI>Analytics and error monitoring providers</LI>
      </UL>
      <P>
        <Strong>Carriers and registration authorities,</Strong> for A2P brand
        and campaign registration, which requires submitting your business
        information.
      </P>
      <P>
        <Strong>Legal and safety recipients:</Strong> we may disclose
        information where required by law, subpoena, or legal process, to
        investigate suspected violations, to protect our rights or the safety of
        others, or in connection with a merger, acquisition, or sale of assets.
      </P>
      <P>
        We do not sell personal information and do not share it for
        cross-context behavioral advertising.
      </P>

      <H2>6. Data retention</H2>
      <P>
        We retain subscriber account information for the life of your account
        and for a reasonable period afterward to meet legal, tax, and accounting
        obligations.
      </P>
      <P>
        Subscriber-uploaded data is retained while your account is active.
        Following cancellation or termination, it is available for export for 30
        days, after which it may be permanently deleted.
      </P>
      <P>
        Records required for compliance purposes, including consent records,
        message logs, and opt-out records, may be retained longer where required
        by law or carrier rules.
      </P>

      <H2>7. Security</H2>
      <P>
        We use industry standard measures including encryption in transit,
        access controls, and authenticated access to protect personal
        information. No system is completely secure, and we cannot guarantee
        absolute security. You are responsible for safeguarding your account
        credentials.
      </P>

      <H2>8. Your rights as a subscriber</H2>
      <P>Depending on where you live, you may have the right to:</P>
      <UL>
        <LI>
          Know what personal information we hold about you and how we use it
        </LI>
        <LI>Access a copy of it</LI>
        <LI>Correct inaccurate information</LI>
        <LI>Request deletion, subject to legal retention requirements</LI>
        <LI>
          Opt out of the sale or sharing of personal information (we do not sell
          or share)
        </LI>
        <LI>
          Not receive discriminatory treatment for exercising these rights
        </LI>
      </UL>
      <P>
        California residents have these rights under the CCPA as amended by the
        CPRA. Residents of other states with comprehensive privacy laws,
        including Texas, Virginia, Colorado, and Connecticut, have comparable
        rights.
      </P>
      <P>
        To exercise any of these rights, email{" "}
        <Mail address="support@reiblast.app" /> from your account email address.
        We respond within 45 days. We may need to verify your identity before
        acting on a request.
      </P>

      <H2>9. If you received a message sent through our platform</H2>
      <P>
        If you received a text message, call, or email sent by one of our
        subscribers and you want to stop receiving them, reply STOP to the
        message. Opt-outs are processed immediately and permanently for that
        sender.
      </P>
      <P>
        If you want your information deleted, we can help but we are not the
        controller of that data. Contact us at{" "}
        <Mail address="support@reiblast.app" /> with the phone number or email
        address in question and the sender if you know it. We will identify the
        subscriber responsible, forward your request, and require them to act on
        it under our{" "}
        <PolicyLink href="/acceptable-use">Acceptable Use Policy</PolicyLink>.
        We will confirm back to you.
      </P>
      <P>
        If you believe you received a message in violation of law, you may also
        report it to us at the address below, and we will investigate.
      </P>

      <H2>10. Cookies</H2>
      <P>
        We use cookies that are strictly necessary for authentication and
        session management, and analytics cookies to understand platform usage.
        You can control cookies through your browser settings, though disabling
        necessary cookies will prevent you from logging in.
      </P>

      <H2>11. Children</H2>
      <P>
        The platform is not directed to anyone under 18 and we do not knowingly
        collect personal information from children. If we learn we have, we will
        delete it.
      </P>

      <H2>12. Changes</H2>
      <P>
        We may update this policy. Material changes will be communicated by
        email or in-platform notice. The date at the top reflects the most
        recent revision.
      </P>

      <H2>13. Contact</H2>
      <LegalContact />
    </LegalPage>
  );
}
