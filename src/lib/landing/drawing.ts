/**
 * The landing page's picture of the product: one card, one fork, two cards. A branch that leaves its parent
 * on the canvas is the whole idea, and three rectangles show it. No text inside: each line of a card is a
 * rounded bar standing in for a line of type, so nothing needs translating and nothing claims to be a
 * screenshot.
 *
 * The geometry lives here, in a 360 × 200 grid that scales with its box, so the Svelte component and the
 * link-preview image script (`pnpm og:image`) draw the same picture and cannot drift apart.
 */
export const VIEWBOX = { width: 360, height: 200 } as const;

/** Every card is the same size; `pad` is the inset from a card's edge to its lines. */
export const CARD = { width: 132, height: 56, radius: 10, pad: 14 } as const;

/** Parent first, then the version you started with and the one you branched into. `lines` are the widths of the prompt and two reply lines. */
export const CARDS = [
	{ x: 114, y: 4, lines: [58, 104, 72] },
	{ x: 14, y: 140, lines: [44, 96, 62] },
	{ x: 214, y: 140, lines: [66, 104, 48] }
] as const;

export type Card = (typeof CARDS)[number];

/** The trunk under the parent, then both branches leaving the same point: the fork is an event on the parent. */
export const EDGES = ['M180 60 V72', 'M180 84 C180 112 80 108 80 140', 'M180 84 C180 112 280 108 280 140'] as const;

/** The branch handle on the trunk: a plus in a ring, the one mark that names the verb. */
export const HANDLE = { cx: 180, cy: 78, r: 6, plus: 'M176.5 78 H183.5 M180 74.5 V81.5' } as const;

export type DrawingColors = { background: string; hairline: string; muted: string; foreground: string };

/** One card's shapes: its frame, its prompt line (shorter, heavier) and two reply lines (longer, quieter). */
export function cardShapes(card: Card) {
	const [prompt, replyA, replyB] = card.lines;
	return {
		frame: { x: card.x, y: card.y, width: CARD.width, height: CARD.height, rx: CARD.radius },
		prompt: { x: card.x + CARD.pad, y: card.y + CARD.pad, width: prompt, height: 6, rx: 3 },
		replies: [
			{ x: card.x + CARD.pad, y: card.y + 30, width: replyA, height: 5, rx: 2.5 },
			{ x: card.x + CARD.pad, y: card.y + 41, width: replyB, height: 5, rx: 2.5 }
		]
	};
}

const attrs = (values: Record<string, string | number>) =>
	Object.entries(values)
		.map(([name, value]) => `${name}="${value}"`)
		.join(' ');

/** The whole drawing as standalone SVG markup, in the component's paint order: edges, parent, handle, children. */
export function drawingSvg(colors: DrawingColors, size: { width: number; height: number }): string {
	const edge = (d: string) =>
		`<path ${attrs({ d, stroke: colors.muted, 'stroke-width': 1.5, 'stroke-linecap': 'round', fill: 'none' })}/>`;
	const card = (c: Card) => {
		const s = cardShapes(c);
		return [
			`<rect ${attrs({ ...s.frame, fill: colors.background, stroke: colors.hairline, 'stroke-width': 1 })}/>`,
			`<rect ${attrs({ ...s.prompt, fill: colors.foreground, 'fill-opacity': 0.8 })}/>`,
			...s.replies.map((r) => `<rect ${attrs({ ...r, fill: colors.muted, 'fill-opacity': 0.45 })}/>`)
		].join('');
	};
	const handle =
		`<circle ${attrs({ cx: HANDLE.cx, cy: HANDLE.cy, r: HANDLE.r, fill: colors.background, stroke: colors.foreground, 'stroke-width': 1.5 })}/>` +
		`<path ${attrs({ d: HANDLE.plus, stroke: colors.foreground, 'stroke-width': 1.5, 'stroke-linecap': 'round' })}/>`;
	const [parent, ...children] = CARDS;
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX.width} ${VIEWBOX.height}" width="${size.width}" height="${size.height}">` +
		EDGES.map(edge).join('') +
		card(parent) +
		handle +
		children.map(card).join('') +
		'</svg>'
	);
}
