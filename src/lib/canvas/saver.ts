import type { NodeWire, ViewWire } from './node-wire';

export type SaveBody = { upserts: NodeWire[]; view?: ViewWire };

export type SaverDeps = {
	getNode(id: string): NodeWire | null;
	depthOf(id: string): number;
	getView(): ViewWire;
	put(body: SaveBody, keepalive: boolean): Promise<{ rejected: string[] }>;
	/** `DELETE /api/nodes/:id` — the server removes the node and everything below it. */
	remove(id: string, keepalive: boolean): Promise<void>;
	isOnline(): boolean;
	/** The banner: a message while saves fail for a non-network reason, null once they succeed. */
	onError(message: string | null): void;
	/** Ids to send first in a keepalive (the streaming nodes). */
	priority(): string[];
	failureMessage: string;
};

export const SAVE_INTERVAL_MS = 1500;
export const MAX_BATCH_NODES = 200;
export const MAX_BATCH_BYTES = 4 * 1024 * 1024 - 64 * 1024;
export const KEEPALIVE_BYTES = 60 * 1024;
/** A backstop on single-node retries per flush; the rest stay dirty for the next one. */
export const MAX_SINGLES_PER_FLUSH = 10;

const encoder = new TextEncoder();
const bytes = (value: unknown) => encoder.encode(JSON.stringify(value)).byteLength;

/**
 * How one request went. Only `invalid_request` and `payload_too_large` are about the nodes' content,
 * so only they isolate the request's nodes (`refused`). Anything else — signed out, CSRF, a rate limit,
 * a database outage, an unexpected throw — would fail every request alike, so it stops the flush.
 */
type Attempt = 'saved' | 'refused' | 'network' | 'stopped';
const classify = (error: unknown): Attempt => {
	const code = (error as { code?: unknown } | null)?.code;
	if (code === 'network') return 'network';
	return code === 'invalid_request' || code === 'payload_too_large' ? 'refused' : 'stopped';
};

/** Remembers which nodes changed, and which branches were deleted, and tells the server — parents first. */
export class Saver {
	private dirty = new Set<string>();
	private viewDirty = false;
	private inFlight: Promise<void> | null = null;
	private inFlightIds = new Set<string>();
	private inFlightView = false;
	/** Nodes the server refused when sent alone: sent one per request until it takes them. */
	private suspects = new Set<string>();
	/** When each node was last sent alone (a counter): the least recent goes first, so none starves under the cap. */
	private suspectTried = new Map<string, number>();
	private tries = 0;
	/** Roots of deleted branches the server has not been told about yet. */
	private deletions = new Set<string>();
	private keepaliveInFlight: Promise<void> | null = null;
	private timer: ReturnType<typeof setInterval> | null = null;

	constructor(
		private deps: SaverDeps,
		private readonly clock = {
			setInterval: ((fn: () => void, ms: number) => globalThis.setInterval(fn, ms)) as typeof setInterval,
			clearInterval: ((id: ReturnType<typeof setInterval>) => globalThis.clearInterval(id)) as typeof clearInterval
		}
	) {}

	markNode(id: string): void {
		this.dirty.add(id);
	}

	markView(): void {
		this.viewDirty = true;
	}

	/** Queues `DELETE /api/nodes/:id`. It goes after the next flush's saves, so it never races one. */
	markDeleted(id: string): void {
		this.deletions.add(id);
	}

	/** Undo before the delete went out: the server never hears of it. (After, the restored nodes are saved again.) */
	cancelDeletion(id: string): void {
		this.deletions.delete(id);
	}

	get pending(): number {
		const ids = new Set([...this.dirty, ...this.inFlightIds]);
		return ids.size + (this.viewDirty || this.inFlightView ? 1 : 0) + this.deletions.size;
	}

	start(): void {
		this.timer ??= this.clock.setInterval(() => void this.flush(), SAVE_INTERVAL_MS);
	}

	stop(): void {
		if (this.timer !== null) this.clock.clearInterval(this.timer);
		this.timer = null;
	}

	/**
	 * The requests a flush would send now: parents first, in batches; then any node the server refused
	 * before, alone, least recently tried first; then the view — with the last batch when nothing goes
	 * alone, otherwise on its own after them, so it never names a node the server does not have yet.
	 * Vanished nodes are dropped.
	 */
	batches(): SaveBody[] {
		const nodes: NodeWire[] = [];
		for (const id of this.dirty) {
			const n = this.deps.getNode(id);
			if (n) nodes.push(n);
			else this.forget(id);
		}
		const order = (a: NodeWire, b: NodeWire) => this.deps.depthOf(a.id) - this.deps.depthOf(b.id) || a.createdAt - b.createdAt;
		nodes.sort(order);
		const suspects = nodes
			.filter((n) => this.suspects.has(n.id))
			.sort((a, b) => (this.suspectTried.get(a.id) ?? 0) - (this.suspectTried.get(b.id) ?? 0) || order(a, b));
		const out: SaveBody[] = [];
		let current: SaveBody = { upserts: [] };
		let size = bytes(current);
		for (const n of nodes) {
			if (this.suspects.has(n.id)) continue;
			const s = bytes(n) + 1;
			if (current.upserts.length > 0 && (current.upserts.length >= MAX_BATCH_NODES || size + s > MAX_BATCH_BYTES)) {
				out.push(current);
				current = { upserts: [] };
				size = bytes(current);
			}
			current.upserts.push(n);
			size += s;
		}
		const view = this.viewDirty ? this.deps.getView() : null;
		if (view && suspects.length === 0) current.view = view;
		if (current.upserts.length > 0 || current.view) out.push(current);
		for (const n of suspects) out.push({ upserts: [n] });
		if (view && suspects.length > 0) out.push({ upserts: [], view });
		return out;
	}

	flush({ keepalive = false }: { keepalive?: boolean } = {}): Promise<void> {
		if (keepalive) return this.flushKeepalive();
		if (this.inFlight) return this.inFlight;
		if (!this.deps.isOnline() || this.pending === 0) return Promise.resolve();
		this.inFlight = this.run().finally(() => (this.inFlight = null));
		return this.inFlight;
	}

	private forget(id: string): void {
		this.dirty.delete(id);
		this.suspects.delete(id);
		this.suspectTried.delete(id);
	}

	private async run(): Promise<void> {
		try {
			const queue = this.batches();
			// Move to in-flight before clearing dirty
			for (const b of queue) b.upserts.forEach((n) => this.inFlightIds.add(n.id));
			if (queue.some((b) => b.view)) this.inFlightView = true;
			this.dirty.clear();
			this.viewDirty = false;

			// Single-node requests: a refused batch split up, and nodes refused on an earlier flush.
			const singles = new Set(queue.filter((b) => b.upserts.length === 1 && !b.view && this.suspects.has(b.upserts[0].id)));
			const unsaved = new Set<string>(); // nodes this flush could not save
			let sentSingles = 0;
			let failed = false; // something the server refused or could not take: the banner goes up
			let halted = false; // the server, or the network, cannot take anything right now
			while (queue.length > 0) {
				let body = queue.shift()!;
				if (singles.has(body) && sentSingles >= MAX_SINGLES_PER_FLUSH) {
					this.requeue([body]);
					unsaved.add(body.upserts[0].id);
					failed = true;
					continue;
				}
				// The view names its target; sent before that node is saved, the server would store none.
				// It waits for the next flush — on its own, or by leaving the batch it rode with.
				const target = body.view?.targetNodeId;
				if (body.view && target && unsaved.has(target)) {
					this.viewDirty = true;
					this.inFlightView = false;
					if (body.upserts.length === 0) continue;
					body = { upserts: body.upserts };
				}
				if (singles.has(body)) {
					sentSingles += 1;
					this.suspectTried.set(body.upserts[0].id, ++this.tries);
				}
				const result = await this.attempt(body);
				if (result === 'saved') continue;
				if (result === 'refused' && body.upserts.length + (body.view ? 1 : 0) > 1) {
					// Find the node(s) the server will not take: one per request, still parents first, then the view.
					const split = body.upserts.map((n) => ({ upserts: [n] }));
					split.forEach((b) => singles.add(b));
					queue.unshift(...split, ...(body.view ? [{ upserts: [], view: body.view }] : []));
					continue;
				}
				// Not confirmed goes back to dirty; changes made meanwhile are already there.
				this.requeue([body]);
				body.upserts.forEach((n) => unsaved.add(n.id));
				if (result === 'refused') {
					body.upserts.forEach((n) => this.suspects.add(n.id));
					failed = true;
					continue;
				}
				// Offline, signed out, rate limited, the server down: sending more now only fails the same way.
				this.requeue(queue);
				if (result === 'network' && !failed) return;
				failed = true;
				halted = true;
				break;
			}
			if (!halted && (await this.sendDeletions()) === 'failed') failed = true;
			this.deps.onError(failed ? this.deps.failureMessage : null);
		} catch {
			// Unexpected error in deps (e.g., getView throws)
			// Put all batched ids back to dirty
			for (const id of this.inFlightIds) this.dirty.add(id);
			if (this.inFlightView) this.viewDirty = true;
			this.inFlightIds.clear();
			this.inFlightView = false;
			try {
				this.deps.onError(this.deps.failureMessage);
			} catch {
				// Ignore errors from onError itself
			}
		}
	}

	/** After the saves: one DELETE per deleted branch. A network failure leaves the rest for next time. */
	private async sendDeletions(): Promise<'ok' | 'failed' | 'offline'> {
		for (const id of [...this.deletions]) {
			if (!this.deletions.has(id)) continue; // undone meanwhile
			try {
				await this.deps.remove(id, false);
				this.deletions.delete(id);
			} catch (error) {
				return classify(error) === 'network' ? 'offline' : 'failed';
			}
		}
		return 'ok';
	}

	private async attempt(body: SaveBody): Promise<Attempt> {
		try {
			await this.deps.put(body, false);
		} catch (error) {
			return classify(error);
		}
		body.upserts.forEach((n) => {
			this.inFlightIds.delete(n.id);
			this.suspects.delete(n.id);
			this.suspectTried.delete(n.id);
		});
		if (body.view) this.inFlightView = false;
		return 'saved';
	}

	private requeue(bodies: SaveBody[]): void {
		for (const b of bodies) {
			b.upserts.forEach((n) => {
				this.dirty.add(n.id);
				this.inFlightIds.delete(n.id);
			});
			if (b.view) {
				this.viewDirty = true;
				this.inFlightView = false;
			}
		}
	}

	/**
	 * Unload path: one request under the browser's keepalive cap; nothing is cleared. A tab closing fires
	 * visibilitychange → hidden and then pagehide, and the two share the browser's 64 KB keepalive
	 * budget, so while one unload save is in flight a second sends nothing more.
	 */
	private flushKeepalive(): Promise<void> {
		this.keepaliveInFlight ??= this.flushKeepaliveImpl()
			.catch(() => {
				// Never reject on the unload path; swallow errors from getNode/getView
			})
			.finally(() => (this.keepaliveInFlight = null));
		return this.keepaliveInFlight;
	}

	private async flushKeepaliveImpl(): Promise<void> {
		// Deletes carry no body, so they cost the keepalive budget nothing: send them first.
		for (const id of this.deletions) void this.deps.remove(id, true).catch(() => {});

		// Candidates = dirty ∪ inFlight
		const candidates = new Set([...this.dirty, ...this.inFlightIds]);
		const first = this.deps.priority().filter((id) => candidates.has(id));
		const rest = [...candidates].filter((id) => !first.includes(id));

		const body: SaveBody = { upserts: [], ...(this.viewDirty || this.inFlightView ? { view: this.deps.getView() } : {}) };
		let size = bytes(body);
		const included = new Set<string>();
		// A node the server refused would sink the whole unload save, and its descendants with it.
		const skipped = new Set([...this.suspects].filter((id) => candidates.has(id)));

		// Walk candidates in priority order, then rest
		const walk = (id: string): string[] => {
			const chain: string[] = [];
			let current: string | null = id;
			while (current !== null) {
				if (included.has(current)) break;
				// If ancestor is skipped (or a candidate not yet included), can't use this candidate
				if (skipped.has(current)) return [];
				if (!candidates.has(current)) break;
				const n = this.deps.getNode(current);
				if (!n) break;
				chain.unshift(current);
				current = n.parentId;
			}
			return chain;
		};

		for (const id of [...first, ...rest]) {
			if (included.has(id) || skipped.has(id)) continue;
			const chain = walk(id);
			if (chain.length === 0) continue;

			// Check if entire chain fits
			let chainSize = 0;
			const nodes: NodeWire[] = [];
			for (const cid of chain) {
				const n = this.deps.getNode(cid);
				if (!n) continue;
				chainSize += bytes(n) + 1;
				nodes.push(n);
			}

			if (size + chainSize > KEEPALIVE_BYTES) {
				// Mark entire chain as skipped
				for (const cid of chain) skipped.add(cid);
				continue;
			}

			// Add entire chain
			for (const n of nodes) {
				body.upserts.push(n);
				included.add(n.id);
			}
			size += chainSize;
		}

		// Sort by depth
		body.upserts.sort((a, b) => this.deps.depthOf(a.id) - this.deps.depthOf(b.id) || a.createdAt - b.createdAt);

		// The same rule on the way out. A target this request leaves out may not be on the server yet,
		// and a view naming it would store no target; the saver cannot tell, so the view waits for the
		// next regular flush (if the tab is closing, a moment of pan and zoom is lost instead).
		const target = body.view?.targetNodeId;
		if (body.view && target && candidates.has(target) && !included.has(target)) delete body.view;
		if (body.upserts.length === 0 && !body.view) return;
		await this.deps.put(body, true);
	}
}
