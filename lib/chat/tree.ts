import { Lead, Tree, TreeNode, TreeOption, LeadFieldName } from './types';
import { validateField, normalizeField } from './extract';

/**
 * Pure decision-tree engine. No React, no I/O, no clock — given a state and an
 * action it returns the next state plus the bot lines to emit. The widget hook
 * wraps these and assigns message ids.
 */

export type Awaiting = 'options' | 'capture' | 'none';

export interface EngineState {
  tree: Tree;
  currentId: string;
  lead: Lead;
  done: boolean;
  awaiting: Awaiting;
}

export interface Step {
  state: EngineState;
  /** Bot lines to append to the transcript. */
  say: string[];
  /** Text to echo as the user's own message, if any. */
  userText?: string;
  /** False when a capture input was rejected (state unchanged). */
  accepted?: boolean;
}

function node(tree: Tree, id: string): TreeNode {
  const n = tree.nodes[id];
  if (!n) throw new Error(`chat tree "${tree.id}" has no node "${id}"`);
  return n;
}

function awaitingFor(n: TreeNode): Awaiting {
  if (n.options && n.options.length) return 'options';
  if (n.capture) return 'capture';
  return 'none';
}

/** Enter a node: emit its lines and compute what input (if any) it awaits. */
function enter(tree: Tree, id: string, lead: Lead): Step {
  const n = node(tree, id);
  return {
    state: {
      tree,
      currentId: id,
      lead,
      done: Boolean(n.end),
      awaiting: awaitingFor(n),
    },
    say: n.say,
  };
}

export function startTree(tree: Tree): Step {
  return enter(tree, tree.start, {});
}

/**
 * Generic transition to an explicit node id, bypassing options/capture.
 * Used by UI-driven steps that aren't a plain option pick or field capture —
 * e.g. confirming the consent-review panel and advancing to the terminal node.
 */
export function advanceTo(state: EngineState, id: string, lead: Lead): Step {
  return { ...enter(state.tree, id, lead), accepted: true };
}

export function chooseOption(state: EngineState, index: number): Step {
  const current = node(state.tree, state.currentId);
  const option: TreeOption | undefined = current.options?.[index];
  if (!option) {
    return { state, say: [], accepted: false };
  }
  const next = enter(state.tree, option.next, state.lead);
  return { ...next, userText: option.label, accepted: true };
}

export function submitCapture(state: EngineState, value: string): Step {
  const current = node(state.tree, state.currentId);
  const capture = current.capture;
  if (!capture) {
    return { state, say: [], accepted: false };
  }

  const field: LeadFieldName = capture.field;
  if (!validateField(field, value)) {
    // Reject — re-prompt, stay on the same node.
    return { state, say: [capture.invalid], userText: value, accepted: false };
  }

  const normalized = normalizeField(field, value);
  const lead: Lead = { ...state.lead, [field]: normalized };
  const next = enter(state.tree, capture.next, lead);
  return { ...next, userText: value, accepted: true };
}

export function skipCapture(state: EngineState): Step {
  const current = node(state.tree, state.currentId);
  const capture = current.capture;
  if (!capture || !capture.optional) {
    return { state, say: [], accepted: false };
  }
  const next = enter(state.tree, capture.next, state.lead);
  return { ...next, userText: capture.skipLabel ?? 'Skip', accepted: true };
}

// --- Selectors ------------------------------------------------------------

export function currentNode(state: EngineState): TreeNode {
  return node(state.tree, state.currentId);
}

export function currentOptions(state: EngineState): TreeOption[] {
  return currentNode(state).options ?? [];
}

export function isCapturing(state: EngineState): boolean {
  return state.awaiting === 'capture';
}

export function captureField(state: EngineState): LeadFieldName | null {
  return currentNode(state).capture?.field ?? null;
}

export function isOptionalCapture(state: EngineState): boolean {
  return Boolean(currentNode(state).capture?.optional);
}

export function skipLabel(state: EngineState): string | null {
  return currentNode(state).capture?.skipLabel ?? null;
}

export function isEnded(state: EngineState): boolean {
  return state.done;
}

export function showsCta(state: EngineState): boolean {
  return Boolean(currentNode(state).cta);
}
