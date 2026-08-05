import type { Metadata } from "next";
import {
  H2,
  Hr,
  LI,
  LegalContact,
  LegalPage,
  P,
  PolicyLink,
  Strong,
  SubHead,
  UL,
} from "@/components/marketing/LegalPage";

export const metadata: Metadata = {
  title: "Acceptable Use Policy — REIblast",
  description:
    "Your obligations when sending messages, calls, and email through REIblast, including consent, opt-out, TCPA compliance, A2P registration accuracy, and prohibited conduct.",
  robots: { index: true, follow: true },
};

export default function AcceptableUsePage() {
  return (
    <LegalPage title="Acceptable Use Policy" lastUpdated="August 5, 2026">
      <P>
        This Acceptable Use Policy governs your use of the REIblast platform and
        is incorporated into our{" "}
        <PolicyLink href="/terms">Terms of Service</PolicyLink>. It applies in
        full to all messaging, calling, and email sent through the platform.
      </P>
      <P>
        Read this section carefully. It defines legal obligations that rest with
        you.
      </P>

      <Hr />

      <H2>1. You are the sender</H2>
      <P>
        REIblast provides software. You decide who to contact, what to send, and
        when to send it.
      </P>
      <P>
        <Strong>
          You are the sender of every message, call, and email transmitted
          through your account.
        </Strong>{" "}
        You are solely responsible for compliance with all laws and regulations
        governing that communication, including but not limited to:
      </P>
      <UL>
        <LI>
          The Telephone Consumer Protection Act (TCPA), 47 U.S.C. § 227, and its
          implementing regulations
        </LI>
        <LI>Federal and state Do Not Call registry requirements</LI>
        <LI>
          State telemarketing, messaging, and mini-TCPA statutes, including
          those in Florida, Oklahoma, Washington, and Maryland
        </LI>
        <LI>The CAN-SPAM Act for email</LI>
        <LI>CTIA messaging principles and best practices</LI>
        <LI>
          Carrier requirements for application-to-person (A2P) messaging,
          including 10DLC brand and campaign registration
        </LI>
        <LI>
          All applicable state and federal laws governing real estate
          solicitation and advertising in the jurisdictions where you operate
        </LI>
      </UL>

      <H2>2. Consent</H2>
      <P>
        <Strong>
          You must have a lawful basis to contact every recipient on every list
          you upload.
        </Strong>
      </P>
      <P>You represent and warrant, each time you send, that:</P>
      <UL>
        <LI>
          You have obtained the consent required by law for the type of message
          you are sending to that recipient
        </LI>
        <LI>
          You maintain records of that consent sufficient to demonstrate it if
          challenged
        </LI>
        <LI>
          The recipient has not revoked consent or requested that you stop
          contacting them
        </LI>
        <LI>
          You have scrubbed your list against the National Do Not Call Registry
          and applicable state registries where required
        </LI>
        <LI>
          You have scrubbed against carrier and litigator exclusion lists where
          appropriate to your use case
        </LI>
      </UL>
      <P>
        Purchasing, renting, scraping, or otherwise acquiring a list does not by
        itself establish consent. The legal standard is consent from the
        individual, not possession of their number.
      </P>

      <H2>3. Opt-out</H2>
      <P>Every messaging campaign you run must honor opt-out requests.</P>
      <UL>
        <LI>
          Include clear opt-out instructions in your messages where required
        </LI>
        <LI>
          Honor STOP, UNSUBSCRIBE, END, QUIT, CANCEL, and equivalent replies
          immediately and permanently
        </LI>
        <LI>
          Do not attempt to contact a recipient who has opted out through a
          different number, channel, or account
        </LI>
        <LI>
          Do not require a recipient to take additional steps, provide
          information, or contact you by another method in order to opt out
        </LI>
      </UL>
      <P>
        The platform processes standard opt-out keywords automatically. You may
        not disable, circumvent, or work around this functionality.
      </P>

      <H2>4. Identification</H2>
      <P>
        Identify yourself and your business in your messages. Do not send
        messages that misrepresent who you are, who you represent, or the
        purpose of your contact.
      </P>

      <H2>5. Prohibited conduct</H2>
      <P>You may not use the platform to:</P>

      <SubHead>Messaging and calling violations</SubHead>
      <UL>
        <LI>
          Send messages to recipients from whom you do not have the required
          consent
        </LI>
        <LI>Send to numbers on Do Not Call registries where prohibited</LI>
        <LI>
          Send outside permitted calling and messaging hours under applicable
          law
        </LI>
        <LI>
          Rotate phone numbers across campaigns to evade carrier filtering, spam
          detection, or opt-out enforcement, a practice known as snowshoeing
        </LI>
        <LI>
          Register a brand or campaign using false, incomplete, or misleading
          business information
        </LI>
        <LI>
          Use the platform to send messages on behalf of an unregistered third
          party or to resell messaging capacity
        </LI>
        <LI>
          Send messages with misleading sender identification or spoofed
          originating numbers
        </LI>
        <LI>Continue sending after receiving an opt-out request</LI>
      </UL>

      <SubHead>Content violations</SubHead>
      <UL>
        <LI>Send content that is fraudulent, deceptive, or misleading</LI>
        <LI>
          Send content that is harassing, threatening, abusive, defamatory, or
          obscene
        </LI>
        <LI>
          Send content relating to categories prohibited by carriers, including
          cannabis, illegal substances, firearms, gambling, high-risk financial
          offers, payday lending, debt relief and credit repair offers that
          violate applicable rules, and sexually explicit material
        </LI>
        <LI>
          Make claims about property values, offers, financing, or your
          authority that are false or that you cannot substantiate
        </LI>
        <LI>Impersonate any person, business, government agency, or lender</LI>
      </UL>

      <SubHead>Platform violations</SubHead>
      <UL>
        <LI>
          Share, resell, sublicense, or provide account access to third parties
        </LI>
        <LI>
          Reverse engineer, copy, or create derivative works from the platform,
          its templates, or its automations
        </LI>
        <LI>
          Attempt to gain unauthorized access to any part of the platform or
          another subscriber&apos;s account
        </LI>
        <LI>
          Interfere with platform operation, or use automated means to extract
          data beyond documented functionality
        </LI>
        <LI>Use the platform for any unlawful purpose</LI>
      </UL>

      <SubHead>Data violations</SubHead>
      <UL>
        <LI>
          Upload personal data you do not have a lawful right to possess and use
        </LI>
        <LI>
          Upload data obtained in violation of another party&apos;s terms of
          service, or through unauthorized access
        </LI>
        <LI>
          Use the platform to process sensitive personal information, including
          financial account numbers, Social Security numbers, or health
          information
        </LI>
      </UL>

      <H2>6. Registration accuracy</H2>
      <P>
        A2P brand and campaign registration requires accurate business
        information submitted to carriers and registration authorities. You must
        provide truthful and complete information, including your legal business
        name, tax identification number, business address, and an accurate
        description of your messaging use case.
      </P>
      <P>
        Submitting false registration information is a violation of carrier
        rules and may result in fines assessed against the registering party,
        campaign termination, and permanent carrier-level blocking.
      </P>
      <P>
        If your business information changes, you must notify us so
        registrations can be updated.
      </P>

      <H2>7. Volume and throughput</H2>
      <P>
        Messaging throughput is limited by carrier-assigned campaign limits and
        by platform per-number sending limits. You may not attempt to exceed
        these limits by any means, including provisioning additional numbers for
        the purpose of circumventing carrier throughput allocations.
      </P>
      <P>
        We may impose sending limits on your account where necessary to protect
        platform stability, carrier relationships, or other subscribers.
      </P>

      <H2>8. Enforcement</H2>
      <P>
        We monitor for policy violations and respond to carrier complaints,
        regulatory inquiries, and recipient reports.
      </P>
      <P>Depending on severity, we may:</P>
      <UL>
        <LI>Issue a warning and require corrective action</LI>
        <LI>Suspend sending capability on your account</LI>
        <LI>Suspend or terminate your account without refund</LI>
        <LI>
          Report the violation to carriers, registration authorities, or law
          enforcement where required
        </LI>
      </UL>
      <P>
        Violations that create immediate legal, regulatory, or carrier risk may
        result in termination without prior warning.
      </P>
      <P>
        Accounts terminated for policy violations are not eligible for refunds
        of any kind, including unused credits.
      </P>

      <H2>9. Your liability</H2>
      <P>
        You agree to indemnify and hold harmless REIblast from any claims,
        damages, penalties, fines, judgments, settlements, losses, and expenses,
        including reasonable attorneys&apos; fees, arising out of your use of
        the platform, the content you transmit, the recipients you contact, or
        your violation of this policy or applicable law.
      </P>
      <P>
        TCPA claims carry statutory damages of $500 to $1,500 per message. These
        claims are brought against the sender. If a claim arising from your
        messaging is brought against us, you are responsible for it.
      </P>
      <P>This section survives termination of your account.</P>

      <H2>10. This is not legal advice</H2>
      <P>
        This policy describes your obligations under our agreement. It is not a
        summary of the law and it is not legal advice. Messaging law is complex,
        varies by state, and changes. You should consult a qualified attorney
        about your specific messaging practices before running campaigns.
      </P>

      <H2>11. Reporting</H2>
      <P>
        To report a violation, or if you have received a message you believe was
        sent in violation of this policy, contact:
      </P>
      <LegalContact />
      <div className="mt-5">
        <P>We investigate all reports and respond within two business days.</P>
      </div>
    </LegalPage>
  );
}
