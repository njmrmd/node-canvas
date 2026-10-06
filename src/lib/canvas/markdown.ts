/**
 * The four constructs replies need — paragraphs, fenced code, lists, inline
 * **bold** / `code` — parsed into plain data. The component renders these
 * with text interpolation only, so nothing a model writes can become markup.
 */
export type Inline = { kind: 'text' | 'strong' | 'code'; text: string };

export type Block =
	| { kind: 'paragraph'; inline: Inline[] }
	/** `start` only when an ordered list does not begin at 1 (a list split by blank lines keeps counting). */
	| { kind: 'list'; ordered: boolean; start?: number; items: Inline[][] }
	| { kind: 'code'; text: string };

const FENCE = /```[^\n]*\n([\s\S]*?)```/g;
const ORDERED_ITEM = /^\s*(\d+)\.\s+(.*)$/;
const ANY_ITEM = /^\s*(?:[-*]|\d+\.)\s+(.*)$/;
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`)/g;
const BLANK = /\n[ \t]*\n/g;

export function parseInline(text: string): Inline[] {
	return text
		.split(INLINE)
		.filter((part) => part !== '')
		.map((part): Inline => {
			if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) return { kind: 'strong', text: part.slice(2, -2) };
			if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) return { kind: 'code', text: part.slice(1, -1) };
			return { kind: 'text', text: part };
		});
}

/**
 * One blank-line-separated chunk of prose: runs of item lines become a list (any marker, at any
 * indent — nested items are flattened), and the lines between them become paragraphs.
 */
function parseProse(chunk: string): Block[] {
	const lines = chunk.split('\n').filter((line) => line.trim() !== '');
	const blocks: Block[] = [];
	let i = 0;
	while (i < lines.length) {
		if (ANY_ITEM.test(lines[i])) {
			const first = lines[i].match(ORDERED_ITEM);
			const items: Inline[][] = [];
			while (i < lines.length && ANY_ITEM.test(lines[i])) items.push(parseInline(lines[i++].match(ANY_ITEM)![1]));
			const start = first ? Number(first[1]) : 1;
			blocks.push(first && start !== 1 ? { kind: 'list', ordered: true, start, items } : { kind: 'list', ordered: !!first, items });
		} else {
			const paragraph: string[] = [];
			while (i < lines.length && !ANY_ITEM.test(lines[i])) paragraph.push(lines[i++]);
			blocks.push({ kind: 'paragraph', inline: parseInline(paragraph.join(' ')) });
		}
	}
	return blocks;
}

export function parseMarkdown(text: string): Block[] {
	const blocks: Block[] = [];
	const pushProse = (segment: string) => {
		for (const chunk of segment.split(/\n\s*\n/)) blocks.push(...parseProse(chunk));
	};
	let cursor = 0;
	FENCE.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = FENCE.exec(text)) !== null) {
		pushProse(text.slice(cursor, match.index));
		blocks.push({ kind: 'code', text: match[1].replace(/\n$/, '') });
		cursor = FENCE.lastIndex;
	}
	pushProse(text.slice(cursor));
	return blocks;
}

/**
 * `parseMarkdown` for text that only grows — a reply as it streams. Everything up to the last blank
 * line that no code fence spans (or the end of the last closed fence) is parsed once and kept; each
 * update parses only what follows. Cutting there is safe because `parseMarkdown` never lets a block
 * cross a blank line outside a fence. The result is always exactly `parseMarkdown(text)`.
 */
export class MarkdownStream {
	private source = '';
	/** text[0, boundary) is parsed, and its blocks are `stable`. */
	private boundary = 0;
	private stable: Block[] = [];
	/** End of the last closed code fence: no fence before it can change. */
	private fenceEnd = 0;
	/** Characters parsed by the last update — for tests: appending must not re-parse the whole reply. */
	parsedChars = 0;

	update(text: string): Block[] {
		if (!text.startsWith(this.source)) {
			this.boundary = 0;
			this.stable = [];
			this.fenceEnd = 0;
		}
		this.source = text;
		this.parsedChars = 0;
		const cut = this.safeCut(text);
		if (cut > this.boundary) {
			this.stable = [...this.stable, ...parseMarkdown(text.slice(this.boundary, cut))];
			this.parsedChars += cut - this.boundary;
			this.boundary = cut;
		}
		const tail = parseMarkdown(text.slice(this.boundary));
		this.parsedChars += text.length - this.boundary;
		return tail.length > 0 ? [...this.stable, ...tail] : this.stable;
	}

	/** The furthest point the text can be cut so that both halves parse as the whole does. */
	private safeCut(text: string): number {
		FENCE.lastIndex = this.fenceEnd;
		while (FENCE.exec(text) !== null) this.fenceEnd = FENCE.lastIndex;
		// A fence that has opened but not closed may still swallow anything after it.
		const opener = text.indexOf('```', this.fenceEnd);
		const limit = opener === -1 ? text.length : opener;
		const from = Math.max(this.boundary, this.fenceEnd);
		const region = text.slice(from, limit);
		let cut = -1;
		BLANK.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = BLANK.exec(region)) !== null) cut = match.index + match[0].length;
		return cut === -1 ? from : from + cut;
	}
}
