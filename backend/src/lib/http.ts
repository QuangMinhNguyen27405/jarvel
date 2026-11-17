// HTTP responses for the API Lambda: JSON, Markdown, the error body (D9) and 5xx bodies with no internal details.
import type { ApiErrorBody, ApiFieldError } from '@jarvel/shared';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

export type HttpResponse = APIGatewayProxyStructuredResultV2;

const BASE_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

export function json(statusCode: number, body: unknown, headers: Record<string, string> = {}): HttpResponse {
  return {
    statusCode,
    headers: { ...BASE_HEADERS, 'content-type': 'application/json; charset=utf-8', ...headers },
    body: JSON.stringify(body),
  };
}

export function markdown(statusCode: number, text: string): HttpResponse {
  return { statusCode, headers: { ...BASE_HEADERS, 'content-type': 'text/markdown; charset=utf-8' }, body: text };
}

export function noContent(): HttpResponse {
  return { statusCode: 204, headers: { ...BASE_HEADERS } };
}

export function errorResponse(
  statusCode: number,
  code: string,
  error: string,
  fields?: ApiFieldError[],
  extra: Record<string, unknown> = {},
): HttpResponse {
  const body: ApiErrorBody & Record<string, unknown> = { error, code, ...(fields ? { fields } : {}), ...extra };
  return json(statusCode, body);
}

/** The only body a 5xx ever carries: no stack, no exception text, no ids of internal resources. */
export function serverError(): HttpResponse {
  return errorResponse(500, 'internal-error', 'Something went wrong on our side. Please try again.');
}

export const notFound = (): HttpResponse => errorResponse(404, 'not-found', 'No such plan.');
export const unauthorized = (): HttpResponse => errorResponse(401, 'unauthorized', 'Sign in to use this API.');
