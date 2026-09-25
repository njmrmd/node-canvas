import { isHttpError, isRedirect, json, type RequestHandler } from '@sveltejs/kit';

/**
 * One error envelope for every JSON route:
 *   { "error": { "code": "invalid_credentials", "message": "…", "fields"?: {…} } }
 * `code` is the stable contract; `message` is written for the person who hit it.
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
	'unsupported_model',
	'no_key_configured',
	'rate_limited',
	'csrf_failed',
	'not_configured',
	'internal_error'
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const STATUS_BY_CODE: Record<ErrorCode, number> = {
	invalid_request: 400,
	payload_too_large: 413,
	unauthenticated: 401,
	not_found: 404,
	email_taken: 409,
	invalid_credentials: 401,
	invalid_api_key: 400,
	provider_unavailable: 502,
	unsupported_model: 400,
	no_key_configured: 409,
	rate_limited: 429,
	csrf_failed: 403,
	not_configured: 503,
	internal_error: 500
};

export function statusFor(code: ErrorCode): number {
	return STATUS_BY_CODE[code];
}

export type ApiErrorBody = {
	error: { code: ErrorCode; message: string; fields?: Record<string, string> };
};

/** Thrown anywhere below a route; `withRoute` turns it into the envelope. */
export class ApiError extends Error {
	readonly code: ErrorCode;
	readonly fields?: Record<string, string>;
	readonly headers?: Record<string, string>;

	constructor(
		code: ErrorCode,
		message: string,
		options?: { fields?: Record<string, string>; headers?: Record<string, string> }
	) {
		super(message);
		this.name = 'ApiError';
		this.code = code;
		this.fields = options?.fields;
		this.headers = options?.headers;
	}
}

export function errorResponse(error: ApiError): Response {
	const body: ApiErrorBody = { error: { code: error.code, message: error.message } };
	if (error.fields) body.error.fields = error.fields;
	return json(body, {
		status: statusFor(error.code),
		headers: { 'Cache-Control': 'no-store', ...error.headers }
	});
}

/**
 * The "logging without leakage" boundary for JSON routes: an ApiError becomes
 * its envelope; anything else is logged by name/message and returned as a
 * generic internal_error. SvelteKit redirects and HTTP errors pass through.
 */
export function withRoute(name: string, handler: RequestHandler): RequestHandler {
	return async (event) => {
		try {
			return await handler(event);
		} catch (error) {
			if (isRedirect(error) || isHttpError(error)) throw error;
			if (error instanceof ApiError) return errorResponse(error);
			const label = error instanceof Error ? error.name : 'non-Error throw';
			const code = typeof (error as Record<string, unknown>).code === 'string' ? (error as Record<string, unknown>).code : undefined;
			console.error(`[${name}] unhandled error: ${label}${code ? ` code=${code}` : ''}`);
			return errorResponse(
				new ApiError('internal_error', 'Something went wrong on our side. Please try again.')
			);
		}
	};
}

/** Per-route cap, in UTF-8 bytes. Routes whose payload grows pass their own. */
export const DEFAULT_MAX_BODY_BYTES = 256 * 1024;

export async function readJsonBody(
	request: Request,
	options?: { maxBytes?: number }
): Promise<Record<string, unknown>> {
	const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BODY_BYTES;

	const contentType = request.headers.get('content-type') ?? '';
	if (!contentType.toLowerCase().includes('application/json')) {
		throw new ApiError('invalid_request', 'Expected a JSON request body.');
	}

	const length = Number(request.headers.get('content-length') ?? '0');
	if (Number.isFinite(length) && length > maxBytes) throw tooLarge();

	const bytes = new Uint8Array(await request.arrayBuffer());
	if (bytes.byteLength > maxBytes) throw tooLarge();

	let parsed: unknown;
	try {
		parsed = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		throw new ApiError('invalid_request', 'Request body is not valid JSON.');
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new ApiError('invalid_request', 'Request body must be a JSON object.');
	}
	return parsed as Record<string, unknown>;
}

function tooLarge(): ApiError {
	return new ApiError('payload_too_large', 'Request body is too large.');
}
