export interface TemplateColors {
  primary: string;
  accent: string;
  background: string;
  text: string;
}

export type ChatRole = 'bot' | 'user';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  /** True while this assistant message is actively streaming in (renders a cursor). */
  streaming?: boolean;
  /** Creation time (ms epoch); drives understated grouped timestamps. */
  ts?: number;
}

export type LeadFieldName = 'name' | 'email' | 'phone';

export interface Lead {
  name?: string;
  email?: string;
  phone?: string;
}

export type ChatMode = 'tree' | 'ai';

/**
 * Runtime config handed to the widget.
 */
export interface ChatConfig {
  enabled: boolean;
  mode: ChatMode;
  brandName: string;
  /** Visual layer (all optional; resolved to defaults in code). */
  ownerName?: string;
  assistantName?: string;
  statusText?: string;
  avatarInitials?: string;
  nudgeMessage?: string;
  welcomeMessage?: string;
  captureEmail: boolean;
  ctaPhone?: string;
  ctaFormHref?: string;
  treeId?: string;
  /** Tree mode: generated decision-tree JSON compiled onto the scaffold. */
  treeJson?: string;
  /** AI mode only — unused in this (tree-only) port. */
  knowledge?: string;
}

/** Resolved font stacks passed to the widget root. */
export interface WidgetFonts {
  heading: string;
  body: string;
}

// --- Decision tree definitions -------------------------------------------

export interface TreeOption {
  /** Button text shown to the user. */
  label: string;
  /** Id of the node to enter when chosen. */
  next: string;
}

export interface TreeCapture {
  field: LeadFieldName;
  /** Re-prompt shown when the input fails validation. */
  invalid: string;
  /** Optional fields can be skipped with a button. */
  optional?: boolean;
  /** Label for the skip button (optional captures only). */
  skipLabel?: string;
  /** Node to enter once captured (or skipped). */
  next: string;
}

export interface TreeNode {
  id: string;
  /** Bot lines emitted on entering this node. */
  say: string[];
  /** Branch choices. Mutually exclusive with `capture` / `end`. */
  options?: TreeOption[];
  /** Ask for a single lead field. */
  capture?: TreeCapture;
  /** Terminal node. */
  end?: boolean;
  /** Show the CTA buttons (call / contact form) on a terminal node. */
  cta?: boolean;
  /**
   * Render the consent-review panel (summary + two required checkboxes)
   * instead of default options/input controls. Scaffold-only — never settable
   * from authored treeJson (compile.ts's node key allowlist excludes it).
   */
  consent?: boolean;
}

export interface Tree {
  id: string;
  start: string;
  nodes: Record<string, TreeNode>;
}

// --- API payloads ---------------------------------------------------------

export interface ChatLeadRequest {
  lead: Lead;
  transcript?: string;
  /** Single consent flag from the widget's consent-review step (both disclosures gate this one flag). */
  smsConsent?: boolean;
  /** ISO timestamp of when consent was given. */
  consentedAt?: string;
}

export interface ChatLeadResponse {
  success: boolean;
  error?: string;
}
