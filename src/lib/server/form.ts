import { ApiError } from './api-error';
import { enforce, type RateLimitPolicy } from './rate-limit';

/** A form field as a string ('' when missing or a file). */
export function str(value: FormDataEntryValue | null): string {
	return typeof value === 'string' ? value : '';
}

/** Runs a rate limit for a form action: null when allowed, the message when refused. */
export async function rateLimitMessage(policy: RateLimitPolicy, subject: string): Promise<string | null> {
	try {
		await enforce(policy, subject);
		return null;
	} catch (error) {
		if (error instanceof ApiError && error.code === 'rate_limited') return error.message;
		throw error;
	}
}
