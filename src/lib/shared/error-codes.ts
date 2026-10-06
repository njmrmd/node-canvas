/**
 * The error vocabulary shared by the server envelope, SSE error frames and
 * the browser. `code` is the stable contract; messages are for people.
 */
export const ERROR_CODES = [
	'invalid_request',
	'payload_too_large',
	'unauthenticated',
	'not_found',
	'email_taken',
	'invalid_credentials',
	'invalid_api_key',
	'provider_unavailable',
	'model_declined',
	'unsupported_model',
	'no_key_configured',
	'rate_limited',
	'csrf_failed',
	'not_configured',
	'internal_error'
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Produced only in the browser: the request never reached us, or no first token arrived. */
export type ClientErrorCode = 'network' | 'timeout';

/** Anything a card can show as its failure. */
export type NodeErrorCode = ErrorCode | ClientErrorCode;

export type ApiErrorBody = {
	error: { code: ErrorCode; message: string; fields?: Record<string, string> };
};
