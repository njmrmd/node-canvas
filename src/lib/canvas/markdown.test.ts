import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseInline, parseMarkdown, MarkdownStream } from './markdown';

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

describe('lists', () => {
	it('keeps the numbering of a list split by blank lines', () => {
		assert.deepEqual(parseMarkdown('1. Fork\n\n2. Rootline\n\n3. Grow'), [
			{ kind: 'list', ordered: true, items: [[{ kind: 'text', text: 'Fork' }]] },
			{ kind: 'list', ordered: true, start: 2, items: [[{ kind: 'text', text: 'Rootline' }]] },
			{ kind: 'list', ordered: true, start: 3, items: [[{ kind: 'text', text: 'Grow' }]] }
		]);
	});

	it('splits a lead-in line from the list under it', () => {
		assert.deepEqual(parseMarkdown('Options:\n- one\n- two'), [
			{ kind: 'paragraph', inline: [{ kind: 'text', text: 'Options:' }] },
			{ kind: 'list', ordered: false, items: [[{ kind: 'text', text: 'one' }], [{ kind: 'text', text: 'two' }]] }
		]);
	});

	it('strips markers from nested and mixed items instead of showing them', () => {
		const [list] = parseMarkdown('1. Parent\n   - child\n2. Next');
		assert.deepEqual(list, {
			kind: 'list',
			ordered: true,
			items: [[{ kind: 'text', text: 'Parent' }], [{ kind: 'text', text: 'child' }], [{ kind: 'text', text: 'Next' }]]
		});
	});
});

describe('MarkdownStream', () => {
	const samples = [
		'Intro paragraph.\n\nSecond one with **bold** and `code`.\n\n1. one\n2. two\n\n- a\n- b',
		'Before.\n\n```js\nconst x = 1;\n\nconst y = 2;\n```\n\nAfter the fence.\n\nMore.',
		'Text ``` mid-line on purpose\n\n```\nopen fence that never closes\n\nstill inside',
		'Para one\nwrapped line.\n\n\n\nAfter several blank lines.\n\n**bold across\n\nblank** stays text.'
	];
	for (const [n, sample] of samples.entries()) {
		it(`matches a full parse at every step, whatever the chunk size (sample ${n + 1})`, () => {
			for (const size of [1, 3, 16, 97]) {
				const stream = new MarkdownStream();
				for (let end = size; end < sample.length + size; end += size) {
					const prefix = sample.slice(0, Math.min(end, sample.length));
					assert.deepEqual(stream.update(prefix), parseMarkdown(prefix), `size ${size}, at ${prefix.length}`);
				}
			}
		});
	}

	it('starts over when the text is not an extension of the last one', () => {
		const stream = new MarkdownStream();
		stream.update('First.\n\nSecond.');
		assert.deepEqual(stream.update('Other.'), parseMarkdown('Other.'));
	});

	it('re-parses only the unfinished tail as a long reply streams in', () => {
		const reply = Array.from({ length: 2000 }, (_, i) => `Paragraph ${i} with a few words in it.`).join('\n\n');
		const stream = new MarkdownStream();
		let most = 0;
		for (let end = 16; end < reply.length; end += 16) {
			stream.update(reply.slice(0, end));
			most = Math.max(most, stream.parsedChars);
		}
		assert.ok(most < 200, `largest single parse was ${most} characters`);
	});
});
