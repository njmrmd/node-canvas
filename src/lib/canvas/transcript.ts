/** The linear view's "Copy all": each exchange as You / Assistant, separated by a rule (the old app's format). */
export function transcriptText(path: readonly { prompt: string; response: string }[]): string {
	return path.map((n) => `You: ${n.prompt}\n\nAssistant: ${n.response}`).join('\n\n---\n\n');
}

/**
 * A reply cut into chunks that each end just after a blank-line run, the separator `parseMarkdown`
 * splits on; the last chunk is the unfinished tail. The linear view draws one text node per chunk, so a
 * token rewrites the tail (and the chunk before it, when the token extends the blank-line run between
 * them), never the whole reply. `paragraphs(t).join('') === t`, and an empty reply has no chunks.
 */
export function paragraphs(text: string): string[] {
	const chunks: string[] = [];
	const blank = /\n\s*\n/g;
	let start = 0;
	for (let match = blank.exec(text); match !== null; match = blank.exec(text)) {
		const end = match.index + match[0].length;
		chunks.push(text.slice(start, end));
		start = end;
	}
	if (start < text.length) chunks.push(text.slice(start));
	return chunks;
}
