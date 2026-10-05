/**
 * The four constructs replies need — paragraphs, fenced code, lists, inline
 * **bold** / `code` — parsed into plain data. The component renders these
 * with text interpolation only, so nothing a model writes can become markup.
 */
export type Inline = { kind: 'text' | 'strong' | 'code'; text: string };

export type Block =
	| { kind: 'paragraph'; inline: Inline[] }
	| { kind: 'list'; ordered: boolean; items: Inline[][] }
	| { kind: 'code'; text: string };

const FENCE = /```[^\n]*\n([\s\S]*?)```/g;
const UNORDERED_ITEM = /^\s*[-*]\s+(.*)$/;
const ORDERED_ITEM = /^\s*\d+\.\s+(.*)$/;
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`)/g;

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

function parseProse(block: string): Block | null {
	const lines = block.split('\n').filter((line) => line.trim() !== '');
	if (lines.length === 0) return null;
	const ordered = ORDERED_ITEM.test(lines[0]);
	if (ordered || UNORDERED_ITEM.test(lines[0])) {
		const pattern = ordered ? ORDERED_ITEM : UNORDERED_ITEM;
		return { kind: 'list', ordered, items: lines.map((line) => parseInline(line.match(pattern)?.[1] ?? line)) };
	}
	return { kind: 'paragraph', inline: parseInline(lines.join(' ')) };
}

export function parseMarkdown(text: string): Block[] {
	const blocks: Block[] = [];
	const pushProse = (segment: string) => {
		for (const chunk of segment.split(/\n\s*\n/)) {
			const block = parseProse(chunk);
			if (block) blocks.push(block);
		}
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
