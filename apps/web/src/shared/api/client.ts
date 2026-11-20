import { errorResponse } from '@app/contracts/errors';
import type { ZodType } from 'zod';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  const parsed = errorResponse.safeParse(await res.json().catch(() => null));
  if (parsed.success) {
    const { code, message, fields } = parsed.data.error;
    return new ApiError(res.status, code, message, fields);
  }
  return new ApiError(res.status, 'UNKNOWN_ERROR', res.statusText || 'Request failed');
}

export interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Parse the JSON response with a contract schema. */
  schema?: ZodType<T>;
  signal?: AbortSignal;
}

/** Calls the same-origin API (always a relative /api path); non-2xx becomes an ApiError. */
export async function api<T = void>(path: string, options: RequestOptions<T> = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal ?? null,
  });
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  const json: unknown = await res.json();
  return options.schema ? options.schema.parse(json) : (json as T);
}
