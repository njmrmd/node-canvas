/** "Resets in …" wording for the limit banner. */
export function formatDuration(seconds: number): string {
	if (seconds < 60) return 'under a minute';
	if (seconds <= 90 * 60) {
		const minutes = Math.ceil(seconds / 60);
		return minutes === 1 ? '1 minute' : `${minutes} minutes`;
	}
	return `${Math.ceil(seconds / 3600)} hours`;
}
