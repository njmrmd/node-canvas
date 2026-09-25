import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** The only key the fake accepts. Shaped like a real key; not a real key. */
export const GOOD_KEY = 'sk-ant-api03-FAKE-test-key-000000000000000000000000000000-good';

function send(res: ServerResponse, status: number, body: unknown) {
	res.writeHead(status, { 'content-type': 'application/json' });
	res.end(JSON.stringify(body));
}

function handle(req: IncomingMessage, res: ServerResponse) {
	if (req.headers['x-api-key'] !== GOOD_KEY) {
		return send(res, 401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
	}
	if (req.method === 'GET' && req.url?.startsWith('/v1/models')) {
		return send(res, 200, { data: [], has_more: false, first_id: null, last_id: null });
	}
	send(res, 404, { type: 'error', error: { type: 'not_found_error', message: 'not found' } });
}

/** Point the SDK at it with ANTHROPIC_BASE_URL=<url>. */
export function startFakeAnthropic(port = 0): Promise<{ url: string; close: () => Promise<void> }> {
	const server = createServer(handle);
	return new Promise((resolve) => {
		server.listen(port, '127.0.0.1', () => {
			const { port: bound } = server.address() as AddressInfo;
			resolve({
				url: `http://127.0.0.1:${bound}`,
				close: () => new Promise((done) => server.close(() => done()))
			});
		});
	});
}
