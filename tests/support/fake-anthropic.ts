import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** The only key the fake accepts. Shaped like a real key; not a real key. */
export const GOOD_KEY = 'sk-ant-api03-FAKE-test-key-000000000000000000000000000000-good';

export type RecordedRequest = {
	path: string;
	headers: Record<string, string | string[] | undefined>;
	body: Record<string, unknown>;
};

const WORDS = (
	'The canvas keeps every branch of a conversation side by side so you can compare where ' +
	'each direction went and come back to any of them later without losing the original path'
).split(' ');

function words(seed: string, n: number): string {
	let h = [...seed].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
	const out: string[] = [];
	for (let i = 0; i < n; i++) {
		h = (h * 1103515245 + 12345) >>> 0;
		out.push(WORDS[h % WORDS.length]);
		if (i % 40 === 39) out.push('\n\n');
	}
	return out.join(' ').replace(/ \n\n /g, '\n\n');
}

function plan(prompt: string) {
	const clean = prompt
		.replace(/\[[a-z]+\]/g, '')
		.trim()
		.slice(0, 60);
	let text = `Echo: ${clean}. ${words(prompt, prompt.includes('[long]') ? 600 : 40)}`;
	if (prompt.includes('[huge]')) text = `${words(prompt, 50_000)} END-OF-HUGE`;
	if (prompt.includes('[markdown]')) {
		text =
			'Here is **bold** and `code`.\n\n- first\n- second\n\n```js\nconst x = 1;\n```\n\n' +
			'<img src=x onerror="window.__xss=1"> <script>window.__xss=2</script>';
	}
	return {
		thinking: prompt.includes('[think]')
			? 'Weighing two readings of the question before answering.'
			: null,
		text,
		refuse: prompt.includes('[refuse]'),
		tokenMs: prompt.includes('[slow]') ? 60 : Number(process.env.FAKE_ANTHROPIC_TOKEN_MS ?? 3),
		wordsPerDelta: prompt.includes('[huge]') ? 500 : 1
	};
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function send(res: ServerResponse, status: number, body: unknown) {
	res.writeHead(status, { 'content-type': 'application/json' });
	res.end(JSON.stringify(body));
}

function sse(res: ServerResponse, event: string, data: unknown) {
	res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function chunks(text: string, perDelta: number): string[] {
	const tokens = text.match(/\S+\s*/g) ?? [];
	const out: string[] = [];
	for (let i = 0; i < tokens.length; i += perDelta)
		out.push(tokens.slice(i, i + perDelta).join(''));
	return out;
}

async function streamMessage(res: ServerResponse, body: Record<string, unknown>) {
	const messages = (body.messages as { role: string; content: unknown }[]) ?? [];
	const last = [...messages].reverse().find((m) => m.role === 'user');
	const p = plan(typeof last?.content === 'string' ? last.content : '');
	let closed = false;
	res.on('close', () => (closed = true));
	res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
	sse(res, 'message_start', {
		type: 'message_start',
		message: {
			id: 'msg_fake',
			type: 'message',
			role: 'assistant',
			model: body.model,
			content: [],
			stop_reason: null,
			stop_sequence: null,
			usage: { input_tokens: 10, output_tokens: 1 }
		}
	});
	let index = 0;
	if (p.thinking) {
		sse(res, 'content_block_start', {
			type: 'content_block_start',
			index,
			content_block: { type: 'thinking', thinking: '', signature: '' }
		});
		for (const piece of chunks(p.thinking, 1)) {
			if (closed) return;
			sse(res, 'content_block_delta', {
				type: 'content_block_delta',
				index,
				delta: { type: 'thinking_delta', thinking: piece }
			});
			await sleep(p.tokenMs);
		}
		sse(res, 'content_block_stop', { type: 'content_block_stop', index });
		index += 1;
	}
	if (p.refuse) {
		sse(res, 'message_delta', {
			type: 'message_delta',
			delta: {
				stop_reason: 'refusal',
				stop_sequence: null,
				stop_details: { type: 'refusal', category: null, explanation: null }
			},
			usage: { output_tokens: 1 }
		});
		sse(res, 'message_stop', { type: 'message_stop' });
		return res.end();
	}
	sse(res, 'content_block_start', {
		type: 'content_block_start',
		index,
		content_block: { type: 'text', text: '' }
	});
	const pieces = chunks(p.text, p.wordsPerDelta);
	for (const piece of pieces) {
		if (closed) return;
		sse(res, 'content_block_delta', {
			type: 'content_block_delta',
			index,
			delta: { type: 'text_delta', text: piece }
		});
		await sleep(p.tokenMs);
	}
	sse(res, 'content_block_stop', { type: 'content_block_stop', index });
	sse(res, 'message_delta', {
		type: 'message_delta',
		delta: { stop_reason: 'end_turn', stop_sequence: null },
		usage: { output_tokens: pieces.length }
	});
	sse(res, 'message_stop', { type: 'message_stop' });
	res.end();
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
	return new Promise((resolve) => {
		let raw = '';
		req.on('data', (c) => (raw += c));
		req.on('end', () => {
			try {
				resolve(raw ? JSON.parse(raw) : {});
			} catch {
				resolve({});
			}
		});
	});
}

/** Point the SDK at it with ANTHROPIC_BASE_URL=<url>. Test infrastructure only. */
export function startFakeAnthropic(
	port = 0
): Promise<{ url: string; requests: RecordedRequest[]; close: () => Promise<void> }> {
	const requests: RecordedRequest[] = [];
	const server = createServer(async (req, res) => {
		const path = (req.url ?? '').split('?')[0];
		if (path === '/__requests' && req.method === 'GET') return send(res, 200, requests);
		if (path === '/__reset' && req.method === 'POST') {
			requests.length = 0;
			return send(res, 200, {});
		}
		if (req.headers['x-api-key'] !== GOOD_KEY) {
			return send(res, 401, {
				type: 'error',
				error: { type: 'authentication_error', message: 'invalid x-api-key' }
			});
		}
		if (req.method === 'GET' && path.startsWith('/v1/models')) {
			return send(res, 200, { data: [], has_more: false, first_id: null, last_id: null });
		}
		if (req.method === 'POST' && path === '/v1/messages') {
			const body = await readBody(req);
			requests.push({ path, headers: req.headers, body });
			if (body.stream !== true)
				return send(res, 400, {
					type: 'error',
					error: { type: 'invalid_request_error', message: 'fake streams only' }
				});
			return streamMessage(res, body);
		}
		send(res, 404, {
			type: 'error',
			error: { type: 'not_found_error', message: 'not found' }
		});
	});
	return new Promise((resolve) => {
		server.listen(port, '127.0.0.1', () => {
			const { port: bound } = server.address() as AddressInfo;
			resolve({
				url: `http://127.0.0.1:${bound}`,
				requests,
				close: () =>
					new Promise((done) => {
						server.closeAllConnections();
						server.close(() => done());
					})
			});
		});
	});
}
