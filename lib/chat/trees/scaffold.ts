import { Tree, TreeNode, TreeOption } from '../types';

/**
 * Fixed decision-tree scaffold — the shell every authored tree shares. It owns
 * the parts that must never be content-authored:
 *   greeting → menu shell → escalate-and-capture flow (name → email → phone →
 *   confirm) → graceful end, plus the shared base content node `@about`.
 *
 * The compiler (`compile.ts`) fills the menu shell from an authored `treeJson`
 * and merges in its content nodes. On its own — with no treeJson — the
 * scaffold is already a valid, compliant, runnable tree.
 *
 * SAFETY: capture / escalation / end / cta live ONLY here. Authored content
 * nodes can express `say` + `options` and route via reserved targets, and
 * nothing else — so an authored node is structurally unable to bypass the
 * capture flow or dead-end a visitor.
 *
 * Reserved-target ids use the `__` prefix so they can never collide with an
 * authored content-node id (the schema forbids `__`-prefixed ids).
 */

export const SCAFFOLD_MENU_ID = '__menu';
export const SCAFFOLD_ABOUT_ID = '__about';
export const SCAFFOLD_CAPTURE_ID = '__capture';
export const SCAFFOLD_CONSENT_ID = '__consent';
export const SCAFFOLD_DONE_ID = '__done';
export const SCAFFOLD_END_ID = '__end';

/** Maps the four reserved targets to their concrete scaffold node ids. */
export const RESERVED_TARGETS: Record<string, string> = {
  '@menu': SCAFFOLD_MENU_ID,
  '@about': SCAFFOLD_ABOUT_ID,
  '@capture': SCAFFOLD_CAPTURE_ID,
  '@end': SCAFFOLD_END_ID,
};

/** Greeting + menu-shell prompt shown by the scaffold's menu node. */
const MENU_GREETING = [
  'Hi! I can help answer a few common questions about REIblast, or connect you with the team.',
  'What would you like to know?',
];

/**
 * The scaffold-only menu, used when there is no (or an invalid) treeJson.
 */
const DEFAULT_MENU: TreeOption[] = [
  { label: 'What is REIblast?', next: '@about' },
  { label: 'I’d like to talk to someone', next: '@capture' },
];

/**
 * The fixed base nodes (everything except the menu node, which the compiler
 * builds from the resolved menu entries). These are merged in as-is.
 */
function scaffoldBaseNodes(): Record<string, TreeNode> {
  return {
    [SCAFFOLD_ABOUT_ID]: {
      id: SCAFFOLD_ABOUT_ID,
      say: [
        'REIblast is an all-in-one text blasting system: SMS text blasting, deal analyzing, e-signing, and more to come.',
      ],
      options: [
        { label: 'Start my free trial', next: SCAFFOLD_CAPTURE_ID },
        { label: 'Back to menu', next: SCAFFOLD_MENU_ID },
      ],
    },

    // --- Escalate-and-capture flow: name → phone → email → consent → confirm ---
    [SCAFFOLD_CAPTURE_ID]: {
      id: SCAFFOLD_CAPTURE_ID,
      say: [
        'Great — let’s get you connected with the team.',
        'First, what’s your name?',
      ],
      capture: {
        field: 'name',
        invalid: 'Sorry, I didn’t catch that — could you type your name?',
        next: '__capture_phone',
      },
    },
    __capture_phone: {
      id: '__capture_phone',
      say: ['Thanks! What’s the best phone number to reach you?'],
      capture: {
        field: 'phone',
        invalid: 'That doesn’t look like a valid phone number — please use a 10-digit format.',
        next: '__capture_email',
      },
    },
    __capture_email: {
      id: '__capture_email',
      say: ['And your email address?'],
      capture: {
        field: 'email',
        invalid: 'That doesn’t look like a valid email — could you double-check and re-enter it?',
        next: '__consent',
      },
    },
    [SCAFFOLD_CONSENT_ID]: {
      id: SCAFFOLD_CONSENT_ID,
      say: ['Almost done — please review and confirm below:'],
      consent: true,
    },
    [SCAFFOLD_DONE_ID]: {
      id: SCAFFOLD_DONE_ID,
      say: [
        'Perfect — you’re all set. Someone from the team will reach out, typically within one business day.',
        'If you’d like to get started right away, you can sign up below.',
      ],
      end: true,
      cta: true,
    },

    // Graceful sign-off for the "just looking" path (@end).
    [SCAFFOLD_END_ID]: {
      id: SCAFFOLD_END_ID,
      say: [
        'No problem at all. Whenever you’re ready, the team is here to help — feel free to reach out anytime.',
      ],
      end: true,
      cta: true,
    },
  };
}

export interface Scaffold {
  /** Runtime tree id (used in engine error messages). */
  id: string;
  /** Start node — the menu shell. */
  start: string;
  /** Id of the menu node whose options the compiler fills. */
  menuNodeId: string;
  /** Greeting + prompt the menu node says. */
  menuGreeting: string[];
  /** Fixed base nodes (excludes the menu node). */
  nodes: Record<string, TreeNode>;
  /** Reserved target → scaffold node id. */
  reserved: Record<string, string>;
  /** Menu used when there is no valid treeJson. */
  defaultMenu: TreeOption[];
}

/** Build a fresh scaffold (id defaults to a neutral value). */
export function buildScaffold(id: string = 'reiblast'): Scaffold {
  return {
    id,
    start: SCAFFOLD_MENU_ID,
    menuNodeId: SCAFFOLD_MENU_ID,
    menuGreeting: MENU_GREETING,
    nodes: scaffoldBaseNodes(),
    reserved: { ...RESERVED_TARGETS },
    defaultMenu: DEFAULT_MENU.map((o) => ({ ...o })),
  };
}

/** Resolve a reserved target (`@x`) or content-node id to a runtime node id. */
export function resolveTarget(next: string, scaffold: Scaffold): string {
  return next.startsWith('@') ? scaffold.reserved[next] ?? next : next;
}

/**
 * The scaffold on its own as a runnable tree: greeting → default menu →
 * `@about` / capture. This is the safe fallback the compiler returns on any
 * validation failure, and the default flow when there is no treeJson.
 */
export function scaffoldOnlyTree(scaffold: Scaffold): Tree {
  const menuNode: TreeNode = {
    id: scaffold.menuNodeId,
    say: scaffold.menuGreeting,
    options: scaffold.defaultMenu.map((o) => ({
      label: o.label,
      next: resolveTarget(o.next, scaffold),
    })),
  };
  return {
    id: scaffold.id,
    start: scaffold.start,
    nodes: { [menuNode.id]: menuNode, ...scaffold.nodes },
  };
}
