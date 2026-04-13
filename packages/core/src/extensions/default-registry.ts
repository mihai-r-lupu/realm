// default-registry.ts — pre-populates ExtensionRegistry with Realm's built-in adapters.
// Used by the execution engine as the fallback when no registry is explicitly provided,
// ensuring built-in adapters are always available without any developer wiring.
import { ExtensionRegistry } from './registry.js';
import { FileSystemAdapter } from '../adapters/file-adapter.js';

/**
 * Returns an ExtensionRegistry pre-populated with Realm's built-in adapters.
 * `FileSystemAdapter` is registered under the name `'filesystem'`.
 *
 * The engine uses this automatically when no registry is provided — workflows that only
 * use built-in adapters need no registry code at all.
 *
 * Use this as a starting point when you need to add your own handlers or adapters on top:
 * ```ts
 * const registry = createDefaultRegistry();
 * registry.register('handler', 'my_handler', myHandler);
 * ```
 */
export function createDefaultRegistry(): ExtensionRegistry {
  const r = new ExtensionRegistry();
  r.register('adapter', 'filesystem', new FileSystemAdapter('filesystem'));
  return r;
}
