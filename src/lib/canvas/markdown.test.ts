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

	it('parses CRLF lists and never hangs on a line no item pattern accepts', () => {
		assert.deepEqual(parseMarkdown('- a\r\n- b'), [
			{ kind: 'list', ordered: false, items: [[{ kind: 'text', text: 'a' }], [{ kind: 'text', text: 'b' }]] }
		]);
		assert.deepEqual(parseMarkdown('1. a\r\n2. b'), [
			{ kind: 'list', ordered: true, items: [[{ kind: 'text', text: 'a' }], [{ kind: 'text', text: 'b' }]] }
		]);
		assert.deepEqual(parseMarkdown('-a b\n- c').map((b) => b.kind), ['paragraph', 'list']);
	});

	it('keeps numbering after a wrapped item line', () => {
		const blocks = parseMarkdown('1. First item that is long\n   and wraps here\n2. Second item\n3. Third');
		assert.deepEqual(blocks.map((b) => b.kind), ['list', 'paragraph', 'list']);
		assert.deepEqual(blocks[2], {
			kind: 'list',
			ordered: true,
			start: 2,
			items: [[{ kind: 'text', text: 'Second item' }], [{ kind: 'text', text: 'Third' }]]
		});
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

	it('a hard-wrapped number does not start a list mid-paragraph', () => {
		assert.deepEqual(parseMarkdown('The war ended in\n1945. Then it was over.'), [
			{ kind: 'paragraph', inline: [{ kind: 'text', text: 'The war ended in 1945. Then it was over.' }] }
		]);
		assert.deepEqual(parseMarkdown('Steps:\n1. one\n2. two'), [
			{ kind: 'paragraph', inline: [{ kind: 'text', text: 'Steps:' }] },
			{ kind: 'list', ordered: true, items: [[{ kind: 'text', text: 'one' }], [{ kind: 'text', text: 'two' }]] }
		]);
	});
});

describe('MarkdownStream', () => {
	const samples = [
		'Intro paragraph.\n\nSecond one with **bold** and `code`.\n\n1. one\n2. two\n\n- a\n- b',
		'Before.\n\n```js\nconst x = 1;\n\nconst y = 2;\n```\n\nAfter the fence.\n\nMore.',
		'Text ``` mid-line on purpose\n\n```\nopen fence that never closes\n\nstill inside',
		'Para one\nwrapped line.\n\n\n\nAfter several blank lines.\n\n**bold across\n\nblank** stays text.',
		'a\n \nb\n\t\nc\n\n```\nx\n \ny\n```\n\t\nz',
		'Before.\r\n\r\n```js\r\nconst x = 1;\r\n\r\nconst y = 2;\r\n```\r\n\r\nAfter the fence.\r\n\r\nMore.',
		'Intro\r\n\r\n- a\r\n- b\r\n\r\n1. x\r\n2. y\r\nwrapped 1945. line'
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

	it('restarts when text changes an earlier character without growing', () => {
		const stream = new MarkdownStream();
		const text1 = 'First.\n\nSecond.';
		stream.update(text1);
		const text2 = 'Fxrst.\n\nSecond.';
		assert.deepEqual(stream.update(text2), parseMarkdown(text2));
	});

	for (const [name, separator] of [['LF', '\n\n'], ['CRLF', '\r\n\r\n']]) {
		it(`re-parses only the unfinished tail as a long reply streams in (${name})`, () => {
			const reply = Array.from({ length: 2000 }, (_, i) => `Paragraph ${i} with a few words in it.`).join(separator);
			const stream = new MarkdownStream();
			let most = 0;
			for (let end = 16; end < reply.length; end += 16) {
				stream.update(reply.slice(0, end));
				most = Math.max(most, stream.parsedChars);
			}
			assert.ok(most < 200, `largest single parse was ${most} characters`);
		});
	}
});
