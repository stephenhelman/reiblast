import { Tree, ChatConfig } from '../types';
import { buildScaffold, scaffoldOnlyTree } from './scaffold';
import { compileTree } from './compile';

/**
 * Resolve the runtime tree for a widget config.
 *   1. `treeJson` present → compile it onto the scaffold. The compiler validates
 *      and, on any failure, falls back to the scaffold-only tree internally.
 *   2. otherwise → the scaffold-only tree.
 */
export function resolveTree(config: Pick<ChatConfig, 'treeId' | 'treeJson'>): Tree {
  const scaffold = buildScaffold(config.treeId || 'reiblast');

  if (config.treeJson && config.treeJson.trim()) {
    return compileTree(scaffold, config.treeJson);
  }

  return scaffoldOnlyTree(scaffold);
}
