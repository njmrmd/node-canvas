import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { paragraphs, transcriptText } from './transcript';

describe('transcriptText', () => {
	it('writes each exchange as You / Assistant, separated by a rule', () => {
		assert.equal(
			transcriptText([
				{ prompt: 'one?', response: 'One.' },
				{ prompt: 'two?', response: 'Two.' }
			]),
			'You: one?\n\nAssistant: One.\n\n---\n\nYou: two?\n\nAssistant: Two.'
		);
	});

	it('is empty for an empty path', () => {
		assert.equal(transcriptText([]), '');
	});

	it('never includes thinking', () => {
		const node = { prompt: 'q', response: 'a', thinking: 'secret reasoning' };
		assert.equal(transcriptText([node]).includes('secret'), false);
	});
});

describe('paragraphs', () => {
	it('joins back to exactly the text it split', () => {
		const samples = [
			'',
			'one paragraph, no blank line',
			'one\n\ntwo',
			'one\n\ntwo\n\n',
			'one\n\n\n\ntwo',
			'one\n \t\n  two',
			'one\r\n\r\ntwo\r\nstill two\r\n\r\n\r\nthree',
			'\n\nstarts with a blank line',
			'ends inside a run\n'
		];
		for (const text of samples) assert.equal(paragraphs(text).join(''), text, JSON.stringify(text));
		// And on random text built from the characters that make, or almost make, a blank line.
		let seed = 1;
		const next = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 16;
		for (let n = 0; n < 2000; n++) {
			const text = Array.from({ length: next() % 30 }, () => 'ab \t\n\r\u00a0'[next() % 7]).join('');
			const chunks = paragraphs(text);
			assert.equal(chunks.join(''), text, JSON.stringify(text));
			assert.ok(chunks.every((c) => c !== ''), JSON.stringify(text));
		}
	});

	it('ends each chunk just after a blank-line run, and keeps the tail as the last', () => {
		assert.deepEqual(paragraphs('one\n\ntwo\n\nthree'), ['one\n\n', 'two\n\n', 'three']);
		assert.deepEqual(paragraphs('one\n\n\n\ntwo'), ['one\n\n\n\n', 'two']);
		assert.deepEqual(paragraphs('one\n \t\n  two'), ['one\n \t\n', '  two']);
		assert.deepEqual(paragraphs('one\r\n\r\ntwo'), ['one\r\n\r\n', 'two']);
		assert.deepEqual(paragraphs('one\n\ntwo\n\n'), ['one\n\n', 'two\n\n']);
	});

	it('keeps a paragraph with no blank line in it as one chunk', () => {
		assert.deepEqual(paragraphs('one line\nand the next'), ['one line\nand the next']);
	});

	it('has no chunks for an empty reply', () => {
		assert.deepEqual(paragraphs(''), []);
	});
});
