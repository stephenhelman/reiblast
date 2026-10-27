import type { DiscordEmbed, DiscordPayload } from "@/lib/discord/webhook";
import { assetUrl, DISCORD_ASSETS, type DiscordAssetKey } from "./discordAssets";
import { FOUNDER_SLOTS_TOTAL, FOUNDER_TRIAL_DAYS } from "./index";
import type { PromoPhase } from "./phase";

// Founder's Offer Discord copy: typed data + pure builders. No env reads, no I/O — the route/preview script pass everything in.
// Never post member names.

export const DISCORD_USERNAME = "REIblast";
export const DISCORD_EMBED_COLOR = 16107586;
export const FOOTER_TEXT = "REIsite & REIkit provided by OP Web Studio, a subsidiary of Operation Profit LLC";
export const VARIATIONS = [1, 2, 3, 4] as const;
export type Variation = (typeof VARIATIONS)[number];

export interface PromoUrls {
  signup: string;
  claim: string;
}
export interface TickInput {
  phase: PromoPhase;
  variation: Variation;
  slotsLeft: number;
  urls: PromoUrls;
  assets?: Record<DiscordAssetKey, string>;
}
export interface LaunchInput {
  urls: PromoUrls;
  roleId?: string | null;
  assets?: Record<DiscordAssetKey, string>;
}

const OPENS = "Wed, Oct 28 at 7 PM CT";
const CLOSES = "Oct 31 at 11:59 PM CT";
const TRIAL_CTA = `Start your ${FOUNDER_TRIAL_DAYS}-day free trial`;
const PRICE_REISITE = "~~$500~~ **$100** for founders";
const PRICE_REIKIT = "~~$25~~ **FREE** for founders";

/** Discord rejects an empty field name; a zero-width space renders as a heading-less field. */
const ZWSP = "\u200b";
const link = (label: string, url: string) => `[${label}](${url})`;
const claimsOpenLine = (slotsLeft: number) =>
  `Founder claims are **OPEN**: **${clampSlots(slotsLeft)} of ${FOUNDER_SLOTS_TOTAL}** REIsite slots left. Claim by ${CLOSES}.`;
const clampSlots = (n: number) => Math.max(0, Math.min(FOUNDER_SLOTS_TOTAL, Math.trunc(Number.isFinite(n) ? n : 0)));

function base(title: string, description: string, url: string, fields: DiscordEmbed["fields"]): DiscordEmbed {
  return { title, description, url, color: DISCORD_EMBED_COLOR, fields };
}
function withImage(e: DiscordEmbed, key: DiscordAssetKey, assets: Record<DiscordAssetKey, string>): DiscordEmbed {
  const url = assetUrl(key, assets);
  return url ? { ...e, image: { url } } : e;
}
const withFooter = (e: DiscordEmbed): DiscordEmbed => ({ ...e, footer: { text: FOOTER_TEXT } });

/** The CTA line(s): pre-launch points at signup only; claims-open adds the member claim link. */
function cta(phase: PromoPhase, urls: PromoUrls, preLabel: string): string {
  return phase === "open"
    ? `${link("Members: claim your slot", urls.claim)} · ${link("New? Start your trial", urls.signup)}`
    : link(preLabel, urls.signup);
}

export function buildTickPayload(input: TickInput): DiscordPayload {
  const { phase, variation, slotsLeft, urls, assets = DISCORD_ASSETS } = input;
  const open = phase === "open";
  const titleUrl = open ? urls.claim : urls.signup;
  let embed: DiscordEmbed;

  switch (variation) {
    case 1:
      embed = withFooter(
        withImage(
          base(
            "🏆 Founding Membership is Open, Ends Oct 31",
            "Join by Oct 31 and become a Founding Member. You get the full platform with built-in support, and you unlock the Founder's Offer.",
            titleUrl,
            [
              { name: "REIsite: Your Investor Website", value: PRICE_REISITE, inline: true },
              { name: "REIkit: Logo + Brand Kit", value: PRICE_REIKIT, inline: true },
              open
                ? {
                    name: "🚨 Founder Claims Are OPEN",
                    value: `${claimsOpenLine(slotsLeft)} The first member to claim gets REIsite free.`,
                  }
                : {
                    name: `Founder Claims Open ${OPENS}`,
                    value: "Only **10** REIsite slots, and the **first member to claim gets REIsite free**. Join before then.",
                  },
              { name: ZWSP, value: cta(phase, urls, TRIAL_CTA) },
            ],
          ),
          open ? "offerClaimsOpen" : "offerPrelaunch",
          assets,
        ),
      );
      break;
    case 2:
      embed = withImage(
        base(
          "You Don't Have to Figure Out Your CRM Alone",
          "Most wholesalers don't quit because of the software, they quit because they're stuck with it alone. Every member gets:",
          titleUrl,
          [
            { name: "💬 Member Community", value: "Investors running the same system, sharing what works.", inline: true },
            { name: "🤖 24/7 AI Support", value: "Account questions answered any time, right here in Discord.", inline: true },
            { name: "🎓 Support Courses", value: "Step-by-step from setup to your first campaign.", inline: true },
            { name: "📞 Live Group Sessions", value: "Help on your actual account, live.", inline: true },
            {
              name: open ? "🚨 Founder Claims Are OPEN" : "Join by Oct 31 for Founder pricing",
              value: `${open ? claimsOpenLine(slotsLeft) : `Founder claims open **${OPENS}**.`}\n${cta(phase, urls, TRIAL_CTA)}`,
            },
          ],
        ),
        "whatsInside",
        assets,
      );
      break;
    case 3:
      embed = withFooter(
        withImage(
          base(
            "Your Own Investor Website, Live in 3 Days, for $100",
            "Sellers look you up before they call you back. No website, or a generic one, and you lose them. REIsite is a full investor website built for you.",
            titleUrl,
            [
              {
                name: "What's Included",
                value: [
                  "• SEO-ready site",
                  "• Lead capture straight into REIblast",
                  "• Hosting included",
                  "• REIkit logo + brand kit, free",
                  "• Live within 3 business days of your intake",
                ].join("\n"),
              },
              { name: "Founder Price", value: `~~$500~~ **$100**\nREIblast members active by Oct 31 only.` },
              {
                name: open ? "🚨 Founder Claims Are OPEN" : "Founder Claims",
                value: open
                  ? `${claimsOpenLine(slotsLeft)}\n${cta(phase, urls, "")}`
                  : `Founder claims open **${OPENS}**, and the first claim is free.\nNot a member yet? ${cta(phase, urls, "Start your trial")}`,
              },
            ],
          ),
          "reisite",
          assets,
        ),
      );
      break;
    case 4:
      embed = withImage(
        base(
          "Quick Question for Wholesalers",
          'When a seller Googles your name after you call them, what do they find? If the answer is "nothing" or "a Facebook page," you\'re losing deals you already paid to generate. Founding members get REIsite, a full investor website with SEO and lead capture into REIblast, for $100 instead of $500.',
          titleUrl,
          [
            { name: "Deadline", value: "Be an active member by Oct 31.", inline: true },
            {
              name: "Already a Member?",
              value: open ? `You qualify. ${claimsOpenLine(slotsLeft)}` : `You qualify. Claims open **${OPENS}**.`,
              inline: true,
            },
            { name: ZWSP, value: cta(phase, urls, "New? Start your trial") },
          ],
        ),
        "googleYou",
        assets,
      );
      break;
  }
  return { username: DISCORD_USERNAME, embeds: [embed] };
}

export function buildLaunchPayload(input: LaunchInput): DiscordPayload {
  const { urls, roleId, assets = DISCORD_ASSETS } = input;
  const embed = withFooter(
    withImage(
      base(
        "🚨 Founder Claims Are OPEN",
        `The first member to claim gets REIsite + REIkit completely free. Then ${FOUNDER_SLOTS_TOTAL - 1} slots at $100 (normally $500).`,
        urls.claim,
        [
          {
            name: "How It Works",
            value: [
              "• We verify you on the claim page",
              "• First claim wins the free slot",
              "• Everyone after gets a $100 invoice",
              "• Your slot locks once it's paid",
              "• Unpaid invoices forfeit after 24 hours",
            ].join("\n"),
          },
          { name: "Who Qualifies", value: "Active or trialing members in good standing. Paused or expired accounts don't qualify." },
          { name: "Claims Close", value: CLOSES },
          { name: ZWSP, value: link("Claim your founder slot", urls.claim) },
        ],
      ),
      "launch",
      assets,
    ),
  );
  const payload: DiscordPayload = { username: DISCORD_USERNAME, embeds: [embed] };
  if (roleId && /^\d{17,20}$/.test(roleId)) {
    payload.content = `<@&${roleId}> Founder claims are open!`;
    payload.allowed_mentions = { roles: [roleId] };
  }
  return payload;
}

/** Discord's embed limits, for tests and a last-line guard. Returns a list of violations (empty = ok). */
export function embedLimitViolations(payload: DiscordPayload): string[] {
  const out: string[] = [];
  for (const e of payload.embeds ?? []) {
    let total = 0;
    const add = (s: string | undefined) => (total += s?.length ?? 0);
    if ((e.title?.length ?? 0) > 256) out.push("title");
    if ((e.description?.length ?? 0) > 4096) out.push("description");
    if ((e.footer?.text.length ?? 0) > 2048) out.push("footer");
    add(e.title);
    add(e.description);
    add(e.footer?.text);
    if ((e.fields?.length ?? 0) > 25) out.push("fields");
    for (const f of e.fields ?? []) {
      if (f.name.length > 256) out.push("field name");
      if (f.value.length > 1024) out.push("field value");
      add(f.name);
      add(f.value);
    }
    if (total > 6000) out.push("total");
  }
  return out;
}
