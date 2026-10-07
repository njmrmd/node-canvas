/** "Resets in …" wording for the limit banner. */
export function formatDuration(seconds: number): string {
	if (seconds < 60) return 'under a minute';
	if (seconds <= 90 * 60) {
		const minutes = Math.ceil(seconds / 60);
		return minutes === 1 ? '1 minute' : `${minutes} minutes`;
	}
	return `${Math.ceil(seconds / 3600)} hours`;
}

/** Whole seconds from `now` until `resetAt` (both epoch milliseconds), rounded up, never negative. */
export function secondsUntil(resetAt: number, now: number): number {
	return Math.max(0, Math.ceil((resetAt - now) / 1000));
}
