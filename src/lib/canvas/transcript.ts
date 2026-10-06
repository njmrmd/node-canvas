/** The linear view's "Copy all": each exchange as You / Assistant, separated by a rule (the old app's format). */
export function transcriptText(path: readonly { prompt: string; response: string }[]): string {
	return path.map((n) => `You: ${n.prompt}\n\nAssistant: ${n.response}`).join('\n\n---\n\n');
}
