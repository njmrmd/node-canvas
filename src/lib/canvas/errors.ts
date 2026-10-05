import { ApiCallError } from './api-client';
import { COPY } from './copy';
import type { NodeError } from './graph';

export type ErrorKind = 'auth' | 'timeout' | 'network' | 'declined' | 'too_long' | 'rate_limited' | 'provider' | 'unknown';

const CATEGORY: Record<ErrorKind, string> = {
	auth: 'Auth error',
	timeout: 'Timed out',
	network: 'Network error',
	declined: 'Declined',
	too_long: 'Too long',
	rate_limited: 'Limit reached',
	provider: 'Provider error',
	unknown: 'Error'
};

/** The first-token watchdog's failure (streams.ts times out; the store records this). */
export const TIMEOUT_ERROR: NodeError = { code: 'timeout', message: 'No response arrived within the time limit.' };

/** A card's failure line, chosen by code — never by matching message text. */
export function presentError(error: NodeError): { kind: ErrorKind; category: string; message: string } {
	const as = (kind: ErrorKind, message: string) => ({ kind, category: CATEGORY[kind], message });
	switch (error.code) {
		case 'invalid_api_key':
		case 'no_key_configured':
			return as('auth', COPY['node.error.auth']);
		case 'network':
			return as('network', COPY['node.error.network']);
		case 'timeout':
			return as('timeout', COPY['node.error.timeout']);
		case 'model_declined':
			return as('declined', error.message);
		case 'rate_limited':
			return as('rate_limited', error.message);
		case 'provider_unavailable':
			return as('provider', error.message);
		case 'payload_too_large':
			return as('too_long', COPY['node.error.context_too_long']);
		case 'invalid_request':
			return /too long/i.test(error.message)
				? as('too_long', COPY['node.error.context_too_long'])
				: as('unknown', COPY['node.error.unknown']);
		default:
			return as('unknown', COPY['node.error.unknown']);
	}
}

/** What `failNode` stores. Only API errors keep their message; anything else is generic. */
export function toNodeError(error: unknown): NodeError {
	if (error instanceof ApiCallError) return { code: error.code, message: error.message };
	return { code: 'internal_error', message: COPY['node.error.unknown'] };
}
