// testAdapter — isolated service adapter test helper.
import type { ServiceAdapter, ServiceResponse } from '@sensigo/realm';

/**
 * Calls adapter.fetch(operation, params, {}) and returns the response.
 * params defaults to {} if not provided.
 */
export async function testAdapter(
  adapter: ServiceAdapter,
  operation: string,
  params?: Record<string, unknown>,
): Promise<ServiceResponse> {
  return adapter.fetch(operation, params ?? {}, {});
}
