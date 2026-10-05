import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseInline, parseMarkdown } from './markdown';

describe('parseMarkdown', () => {
	it('renders a plain paragraph', () => {
		assert.deepEqual(parseMarkdown('Hello there.'), [{ kind: 'paragraph', inline: [{ kind: 'text', text: 'Hello there.' }] }]);
	});

	it('joins a paragraph lines and splits paragraphs on blank lines', () => {
		const blocks = parseMarkdown('one\ntwo\n\nthree');
		assert.equal(blocks.length, 2);
		assert.deepEqual(blocks[0], { kind: 'paragraph', inline: [{ kind: 'text', text: 'one two' }] });
	});

	it('parses **bold** and `inline code`', () => {
		assert.deepEqual(parseInline('This is **important**, run `npm i`.'), [
			{ kind: 'text', text: 'This is ' },
			{ kind: 'strong', text: 'important' },
			{ kind: 'text', text: ', run ' },
			{ kind: 'code', text: 'npm i' },
			{ kind: 'text', text: '.' }
		]);
	});

	it('parses a fenced code block, keeping text around it', () => {
		const blocks = parseMarkdown('Before.\n\n```js\nconst x = 1;\n```\n\nAfter.');
		assert.deepEqual(blocks.map((b) => b.kind), ['paragraph', 'code', 'paragraph']);
		assert.deepEqual(blocks[1], { kind: 'code', text: 'const x = 1;' });
	});

	it('parses numbered and bulleted lists', () => {
		const [ol] = parseMarkdown('1. Fork\n2. Rootline');
		assert.deepEqual(ol, { kind: 'list', ordered: true, items: [[{ kind: 'text', text: 'Fork' }], [{ kind: 'text', text: 'Rootline' }]] });
		const [ul] = parseMarkdown('- Alpha\n* Beta');
		assert.equal(ul.kind === 'list' && ul.ordered, false);
	});

	it('leaves an unclosed fence (mid-stream) as prose', () => {
		assert.deepEqual(parseMarkdown('```js\nconst').map((b) => b.kind), ['paragraph']);
	});

	it('treats HTML as text - there is no HTML node type to produce', () => {
		const text = '<img src=x onerror="alert(1)"> and <script>alert(2)</script>';
		const blocks = parseMarkdown(text);
		assert.deepEqual(blocks, [{ kind: 'paragraph', inline: [{ kind: 'text', text }] }]);
	});

	it('returns nothing for empty text', () => {
		assert.deepEqual(parseMarkdown(''), []);
	});
});
