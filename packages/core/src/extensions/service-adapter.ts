// Service adapter — handles communication with a specific external API.

export interface ServiceResponse {
  status: number;
  data: unknown;
}

export interface ServiceAdapter {
  readonly id: string;
  fetch(
    operation: string,
    params: Record<string, unknown>,
    config: Record<string, unknown>,
  ): Promise<ServiceResponse>;
  create(
    operation: string,
    params: Record<string, unknown>,
    config: Record<string, unknown>,
  ): Promise<ServiceResponse>;
  update(
    operation: string,
    params: Record<string, unknown>,
    config: Record<string, unknown>,
  ): Promise<ServiceResponse>;
}
