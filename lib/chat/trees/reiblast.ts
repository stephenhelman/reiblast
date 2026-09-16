import { TEXT_RATE, DAILY_CAP_SOLE, DAILY_CAP_LLC, RAMP_RUNGS } from '@/lib/pricing';
import type { TreeJson, TreeJsonNode, TreeJsonOption } from './compile';

/**
 * Authored treeJson content for the REIblast marketing chat widget.
 * Ladder cost lines are computed from lib/pricing.ts's TEXT_RATE — never
 * typed as literals — so they can't drift from the cost calculator or FAQ.
 */

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function money(n: number): string {
  return `$${round2(n).toFixed(2)}`;
}

const FAQ_BILLING_CTA = 'For A2P and other billing details, read our FAQ → /faq#billing';

const SOLE_LADDER = [250, 500, 1000, 2000, 3000];
const LLC_LADDER = [250, 500, 1000, 2000, 3000, 4000, 5000, 6000];

function costLeaf(id: string, texts: number): TreeJsonNode {
  return {
    id,
    say: [
      `${texts.toLocaleString('en-US')} texts/day ≈ ${money(texts * TEXT_RATE)}/day at $${TEXT_RATE} per text.`,
      FAQ_BILLING_CTA,
    ],
    options: [{ label: 'Back to menu', next: '@menu' }],
  };
}

const soleLeaves = SOLE_LADDER.map((n) => costLeaf(`sole_${n}`, n));
const llcLeaves = LLC_LADDER.map((n) => costLeaf(`llc_${n}`, n));

function ladderOption(n: number, prefix: 'sole' | 'llc'): TreeJsonOption {
  return { label: `${n.toLocaleString('en-US')} texts/day`, next: `${prefix}_${n}` };
}

const nodes: TreeJsonNode[] = [
  {
    id: 'what_is',
    say: [
      "We're an all-in-one text blasting system. SMS text blasting, deal analyzing, e-signing, and more to come.",
      'For more information, check out our features → /features',
    ],
    options: [
      { label: 'Tell me about the deal analyzer', next: 'deal_analyzer' },
      { label: 'Tell me about the lead cleaner', next: 'lead_cleaner' },
      { label: 'Back to menu', next: '@menu' },
    ],
  },
  {
    id: 'deal_analyzer',
    say: [
      'Load in your address, choose your comps, and get an AI score of your deal — all without leaving your system.',
    ],
    options: [{ label: 'Back to menu', next: '@menu' }],
  },
  {
    id: 'lead_cleaner',
    say: [
      "Take a list from BatchLeads, PropStream, or DealMachine, and scrub out any number that isn't mobile. Get you blasting your list faster.",
    ],
    options: [{ label: 'Back to menu', next: '@menu' }],
  },
  {
    id: 'costs',
    say: ['What would you like to know about pricing?'],
    options: [
      { label: 'Monthly cost of the service', next: 'costs_monthly' },
      { label: 'Cost to send texts', next: 'texting_limits' },
      { label: 'Back to menu', next: '@menu' },
    ],
  },
  {
    id: 'costs_monthly',
    say: [
      "$57/month membership. Phone number(s) are $1.265/mo each. That's the recurring service cost.",
      FAQ_BILLING_CTA,
    ],
    options: [{ label: 'Back to menu', next: '@menu' }],
  },
  {
    id: 'texting_limits',
    say: ['Do you have an LLC or EIN?'],
    options: [
      { label: 'No, I’m a sole proprietor', next: 'texting_sole' },
      { label: 'Yes, I have an LLC/EIN', next: 'texting_llc' },
      { label: 'How does ramp-up work?', next: 'ramp_explainer' },
      { label: 'Back to menu', next: '@menu' },
    ],
  },
  {
    id: 'texting_sole',
    say: [
      `As a sole proprietor you can send up to ${DAILY_CAP_SOLE.toLocaleString('en-US')} texts/day.`,
      'How many text messages would you send in a day?',
    ],
    options: [
      ladderOption(250, 'sole'),
      ladderOption(500, 'sole'),
      ladderOption(1000, 'sole'),
      { label: 'More options →', next: 'texting_sole_more' },
    ],
  },
  {
    id: 'texting_sole_more',
    say: ['More daily volumes:'],
    options: [
      ladderOption(2000, 'sole'),
      ladderOption(3000, 'sole'),
      { label: 'Back to menu', next: '@menu' },
    ],
  },
  {
    id: 'texting_llc',
    say: [
      `With an LLC/EIN you can send up to ${DAILY_CAP_LLC.toLocaleString('en-US')} texts/day.`,
      'How many text messages would you send in a day?',
    ],
    options: [
      ladderOption(250, 'llc'),
      ladderOption(500, 'llc'),
      ladderOption(1000, 'llc'),
      { label: 'More options →', next: 'texting_llc_more' },
    ],
  },
  {
    id: 'texting_llc_more',
    say: ['More daily volumes:'],
    options: [
      ladderOption(2000, 'llc'),
      ladderOption(3000, 'llc'),
      ladderOption(4000, 'llc'),
      { label: 'More options →', next: 'texting_llc_more2' },
    ],
  },
  {
    id: 'texting_llc_more2',
    say: ['Even higher volumes:'],
    options: [
      ladderOption(5000, 'llc'),
      ladderOption(6000, 'llc'),
      { label: 'Back to menu', next: '@menu' },
    ],
  },
  {
    id: 'ramp_explainer',
    say: [
      `New accounts start at ${RAMP_RUNGS[0].toLocaleString('en-US')} segments/day and step up (${RAMP_RUNGS.map((n) => n.toLocaleString('en-US')).join(' → ')} → your ceiling) each day you hit your limit, until you reach your target or your account cap. This protects deliverability.`,
    ],
    options: [{ label: 'Back to menu', next: '@menu' }],
  },
  {
    id: 'how_join',
    say: ['Sign up today and get a free 7-day trial → /checkout'],
    options: [{ label: 'Back to menu', next: '@menu' }],
  },
  ...soleLeaves,
  ...llcLeaves,
];

const treeJson: TreeJson = {
  version: 1,
  menu: [
    { label: 'What is REIblast?', next: 'what_is' },
    { label: 'Costs & pricing', next: 'costs' },
    { label: 'Texting: limits & cost', next: 'texting_limits' },
    { label: 'How do I join?', next: 'how_join' },
    { label: 'Talk to a person', next: '@capture' },
  ],
  nodes,
};

export const REIBLAST_TREE_JSON = JSON.stringify(treeJson);
