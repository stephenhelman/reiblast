import { Tree, TreeNode, TreeOption } from '../types';
import { Scaffold, scaffoldOnlyTree, resolveTarget } from './scaffold';

/**
 * Tree compiler: validate a client's generated `treeJson` against the contract
 * in `.claude/tree-content-node-schema.md`, resolve its reserved targets to
 * scaffold nodes, and merge it onto the scaffold to produce the runtime `Tree`
 * the existing engine runs unchanged.
 *
 * Fail loud, fall back safe: on ANY hard validation failure this returns the
 * scaffold-only tree and logs the reason — it never throws and never renders a
 * partial tree. Unreachable nodes warn but do not fail.
 */

// --- treeJson shape (the contract) ---------------------------------------

export interface TreeJsonOption {
  label: string;
  next: string;
}
export interface TreeJsonNode {
  id: string;
  say: string[];
  options?: TreeJsonOption[];
}
export interface TreeJson {
  version: number;
  menu: TreeJsonOption[];
  nodes: TreeJsonNode[];
}

// --- Contract constants ---------------------------------------------------

const RESERVED = new Set(['@menu', '@capture', '@end', '@about']);
const ID_RE = /^[a-z0-9_]+$/;
const NEXT_RE = /^(@(menu|capture|end|about)|[a-z0-9_]+)$/;
const MAX_SAY_LINES = 3;
const MAX_SAY_LEN = 320;
const MAX_LABEL_LEN = 40;
const MAX_OPTIONS = 4;
const MAX_MENU = 6;
const MAX_NODES = 30;

type ValidationResult =
  | { ok: true; value: TreeJson; warnings: string[] }
  | { ok: false; reason: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Enforce object-key allowlist (schema `additionalProperties: false`). */
function extraKeys(obj: Record<string, unknown>, allowed: string[]): string[] {
  return Object.keys(obj).filter((k) => !allowed.includes(k));
}

/**
 * Validate a parsed treeJson against the schema plus the semantic rules that
 * JSON Schema alone can't express (no id collisions, no dangling `next`).
 * Rejecting `additionalProperties` on nodes is a safety guardrail: it prevents
 * a content node from smuggling in a `capture` / `end` / `cta` field.
 */
function validateTreeJson(raw: unknown): ValidationResult {
  const fail = (reason: string): ValidationResult => ({ ok: false, reason });

  if (!isPlainObject(raw)) return fail('treeJson is not an object');

  const topExtra = extraKeys(raw, ['version', 'menu', 'nodes']);
  if (topExtra.length) return fail(`unexpected top-level key(s): ${topExtra.join(', ')}`);

  if (raw.version !== 1) return fail(`version must be 1 (got ${JSON.stringify(raw.version)})`);

  if (!Array.isArray(raw.menu)) return fail('menu must be an array');
  if (raw.menu.length < 1 || raw.menu.length > MAX_MENU)
    return fail(`menu must have 1–${MAX_MENU} entries (got ${raw.menu.length})`);

  if (!Array.isArray(raw.nodes)) return fail('nodes must be an array');
  if (raw.nodes.length > MAX_NODES)
    return fail(`nodes must have at most ${MAX_NODES} entries (got ${raw.nodes.length})`);

  // First pass over nodes: shape, ids, say, options shape. Collect ids.
  const ids = new Set<string>();
  for (let i = 0; i < raw.nodes.length; i++) {
    const n = raw.nodes[i];
    const at = `nodes[${i}]`;
    if (!isPlainObject(n)) return fail(`${at} is not an object`);
    const nExtra = extraKeys(n, ['id', 'say', 'options']);
    if (nExtra.length) return fail(`${at} has unexpected key(s): ${nExtra.join(', ')}`);

    if (typeof n.id !== 'string' || !ID_RE.test(n.id))
      return fail(`${at}.id must match /^[a-z0-9_]+$/ (got ${JSON.stringify(n.id)})`);
    if (n.id.startsWith('__'))
      return fail(`${at}.id "${n.id}" uses the reserved "__" prefix`);
    if (ids.has(n.id)) return fail(`duplicate node id "${n.id}"`);
    ids.add(n.id);

    if (!Array.isArray(n.say) || n.say.length < 1 || n.say.length > MAX_SAY_LINES)
      return fail(`${at}.say must have 1–${MAX_SAY_LINES} lines`);
    for (const line of n.say) {
      if (typeof line !== 'string' || line.length < 1 || line.length > MAX_SAY_LEN)
        return fail(`${at}.say lines must be strings of 1–${MAX_SAY_LEN} chars`);
    }

    if (n.options !== undefined) {
      if (!Array.isArray(n.options)) return fail(`${at}.options must be an array`);
      if (n.options.length > MAX_OPTIONS)
        return fail(`${at}.options must have at most ${MAX_OPTIONS} entries`);
      for (let j = 0; j < n.options.length; j++) {
        const optErr = validateOptionShape(n.options[j], `${at}.options[${j}]`);
        if (optErr) return fail(optErr);
      }
    }
  }

  // Menu entry shape.
  for (let i = 0; i < raw.menu.length; i++) {
    const optErr = validateOptionShape(raw.menu[i], `menu[${i}]`);
    if (optErr) return fail(optErr);
  }

  // Second pass: every `next` resolves to a defined content id or reserved target.
  const nexts: Array<{ next: string; where: string }> = [];
  raw.menu.forEach((m: TreeJsonOption, i: number) => nexts.push({ next: m.next, where: `menu[${i}].next` }));
  raw.nodes.forEach((n: TreeJsonNode, i: number) =>
    (n.options ?? []).forEach((o, j) => nexts.push({ next: o.next, where: `nodes[${i}].options[${j}].next` }))
  );
  for (const { next, where } of nexts) {
    const resolvable = next.startsWith('@') ? RESERVED.has(next) : ids.has(next);
    if (!resolvable) return fail(`dangling reference at ${where}: "${next}" is not a defined node or reserved target`);
  }

  return { ok: true, value: raw as unknown as TreeJson, warnings: reachabilityWarnings(raw as unknown as TreeJson, ids) };
}

function validateOptionShape(opt: unknown, at: string): string | null {
  if (!isPlainObject(opt)) return `${at} is not an object`;
  const extra = extraKeys(opt, ['label', 'next']);
  if (extra.length) return `${at} has unexpected key(s): ${extra.join(', ')}`;
  if (typeof opt.label !== 'string' || opt.label.length < 1 || opt.label.length > MAX_LABEL_LEN)
    return `${at}.label must be a string of 1–${MAX_LABEL_LEN} chars`;
  if (typeof opt.next !== 'string' || !NEXT_RE.test(opt.next))
    return `${at}.next must match /^(@(menu|capture|end|about)|[a-z0-9_]+)$/ (got ${JSON.stringify(opt.next)})`;
  return null;
}

/** Warn (don't fail) on content nodes unreachable from the menu. */
function reachabilityWarnings(tj: TreeJson, ids: Set<string>): string[] {
  const reachable = new Set<string>();
  const queue: string[] = [];
  const visit = (next: string) => {
    if (!next.startsWith('@') && ids.has(next) && !reachable.has(next)) {
      reachable.add(next);
      queue.push(next);
    }
  };
  tj.menu.forEach((m) => visit(m.next));
  while (queue.length) {
    const id = queue.shift()!;
    const node = tj.nodes.find((n) => n.id === id);
    (node?.options ?? []).forEach((o) => visit(o.next));
  }
  return [...ids]
    .filter((id) => !reachable.has(id))
    .map((id) => `unreachable node "${id}" (not linked from the menu or any node)`);
}

// --- Merge ----------------------------------------------------------------

function mergeTree(scaffold: Scaffold, tj: TreeJson): Tree {
  const nodes: Record<string, TreeNode> = {};

  // Fixed scaffold base nodes, as-is.
  for (const [id, n] of Object.entries(scaffold.nodes)) nodes[id] = n;

  // Menu node: greeting from scaffold, options from the compiled menu.
  nodes[scaffold.menuNodeId] = {
    id: scaffold.menuNodeId,
    say: scaffold.menuGreeting,
    options: tj.menu.map((m) => ({ label: m.label, next: resolveTarget(m.next, scaffold) })),
  };

  // Client content nodes → runtime TreeNodes (say + options only).
  const capture = scaffold.reserved['@capture'];
  const menu = scaffold.reserved['@menu'];
  for (const cn of tj.nodes) {
    const hasOptions = Array.isArray(cn.options) && cn.options.length > 0;
    const options: TreeOption[] = hasOptions
      ? cn.options!.map((o) => ({ label: o.label, next: resolveTarget(o.next, scaffold) }))
      : // Auto-continuation: a 0-option node is never a dead-end.
        [
          { label: 'Start my free review', next: capture },
          { label: 'Back to menu', next: menu },
        ];
    nodes[cn.id] = { id: cn.id, say: cn.say.slice(), options };
  }

  return { id: scaffold.id, start: scaffold.start, nodes };
}

// --- Public API -----------------------------------------------------------

/**
 * Compile a client's treeJson onto the scaffold into a runnable `Tree`.
 * Accepts the raw Sanity string or an already-parsed object. On any hard
 * failure (bad JSON, schema violation, dangling reference) it logs the reason
 * and returns the scaffold-only tree — never a broken or partial tree.
 */
export function compileTree(scaffold: Scaffold, treeJsonRaw: string | unknown): Tree {
  let parsed: unknown = treeJsonRaw;

  if (typeof treeJsonRaw === 'string') {
    try {
      parsed = JSON.parse(treeJsonRaw);
    } catch (e) {
      console.warn(
        `[tree-compiler] invalid JSON — falling back to scaffold-only tree: ${(e as Error).message}`
      );
      return scaffoldOnlyTree(scaffold);
    }
  }

  const result = validateTreeJson(parsed);
  if (!result.ok) {
    console.warn(
      `[tree-compiler] treeJson rejected (${result.reason}) — falling back to scaffold-only tree`
    );
    return scaffoldOnlyTree(scaffold);
  }

  for (const w of result.warnings) console.warn(`[tree-compiler] ${w}`);

  return mergeTree(scaffold, result.value);
}
