// default-registry.ts — pre-populates ExtensionRegistry with Realm's built-in adapters.
// Used by the execution engine as the fallback when no registry is explicitly provided,
// ensuring built-in adapters are always available without any developer wiring.
import { ExtensionRegistry } from './registry.js';
import { FileSystemAdapter } from '../adapters/file-adapter.js';
import { SlackAdapter } from '../adapters/slack-adapter.js';

/**
 * Returns an ExtensionRegistry pre-populated with Realm's built-in adapters.
 * `FileSystemAdapter` is registered under `'filesystem'`.
 * `SlackAdapter` is registered under `'slack'` with `webhook_url` taken from the
 * `SLACK_WEBHOOK_URL` environment variable. If the variable is absent the adapter
 * is still registered but will fail at call time via `ADAPTER_REQUEST_FAILED`.
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
  r.register(
    'adapter',
    'slack',
    new SlackAdapter('slack', {
      webhook_url: process.env['SLACK_WEBHOOK_URL'] ?? '',
    }),
  );
  return r;
}
