// Service adapter — handles communication with a specific external API.

export interface ServiceResponse {
  status: number;
  data: unknown;
}

/**
 * Service adapter — handles communication with a specific external API.
 *
 * Implementors that perform multi-step operations (paginated fetch, multi-part upload,
 * sequential writes) must check `signal?.aborted` between steps and throw if true.
 * Passing the signal to native `fetch()` handles single-request cancellation automatically.
 */
export interface ServiceAdapter {
  readonly id: string;
  fetch(
    operation: string,
    params: Record<string, unknown>,
    config: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ServiceResponse>;
  create(
    operation: string,
    params: Record<string, unknown>,
    config: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ServiceResponse>;
  update(
    operation: string,
    params: Record<string, unknown>,
    config: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ServiceResponse>;
}
