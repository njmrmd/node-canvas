import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CARD, CARDS, cardShapes, drawingSvg, EDGES, HANDLE, VIEWBOX } from './drawing';

describe('the landing drawing', () => {
	it('keeps every card inside the grid, and every line inside its card', () => {
		for (const card of CARDS) {
			assert.ok(card.x >= 0 && card.x + CARD.width <= VIEWBOX.width, `card at x ${card.x}`);
			assert.ok(card.y >= 0 && card.y + CARD.height <= VIEWBOX.height, `card at y ${card.y}`);
			const { prompt, replies } = cardShapes(card);
			for (const line of [prompt, ...replies]) {
				assert.ok(line.x + line.width <= card.x + CARD.width - CARD.pad, `a line overflows the card at x ${card.x}`);
			}
		}
	});

	it('joins the trunk to the parent and each branch to a child, at their centres', () => {
		const [parent, left, right] = CARDS;
		const centre = (card: (typeof CARDS)[number]) => card.x + CARD.width / 2;
		assert.equal(EDGES[0], `M${centre(parent)} ${parent.y + CARD.height} V72`);
		assert.ok(EDGES[1].endsWith(`${centre(left)} ${left.y}`), EDGES[1]);
		assert.ok(EDGES[2].endsWith(`${centre(right)} ${right.y}`), EDGES[2]);
		assert.equal(HANDLE.cx, centre(parent));
	});

	it('draws three cards, three edges and the branch handle as standalone SVG', () => {
		const svg = drawingSvg({ background: '#fff', hairline: '#eee', muted: '#777', foreground: '#111' }, { width: 432, height: 240 });
		assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 360 200" width="432" height="240">/);
		assert.equal(svg.match(/<rect /g)?.length, 12, 'a frame, a prompt line and two reply lines per card');
		assert.equal(svg.match(/<path /g)?.length, 4, 'three edges and the plus');
		assert.equal(svg.match(/<circle /g)?.length, 1);
		assert.ok(svg.endsWith('</svg>'));
	});
});
