import type { NodeWire, ViewWire } from './node-wire';

export type SaveBody = { upserts: NodeWire[]; view?: ViewWire };

export type SaverDeps = {
	getNode(id: string): NodeWire | null;
	depthOf(id: string): number;
	getView(): ViewWire;
	put(body: SaveBody, keepalive: boolean): Promise<{ rejected: string[] }>;
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

const encoder = new TextEncoder();
const bytes = (value: unknown) => encoder.encode(JSON.stringify(value)).byteLength;
const isNetwork = (error: unknown) => (error as { code?: unknown } | null)?.code === 'network';

/** Remembers which nodes changed and sends only those, parents first. */
export class Saver {
	private dirty = new Set<string>();
	private viewDirty = false;
	private inFlight: Promise<void> | null = null;
	private inFlightIds = new Set<string>();
	private inFlightView = false;
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

	get pending(): number {
		const totalDirty = this.dirty.size + this.inFlightIds.size;
		const totalView = this.viewDirty || this.inFlightView ? 1 : 0;
		return totalDirty + totalView;
	}

	start(): void {
		this.timer ??= this.clock.setInterval(() => void this.flush(), SAVE_INTERVAL_MS);
	}

	stop(): void {
		if (this.timer !== null) this.clock.clearInterval(this.timer);
		this.timer = null;
	}

	/** The requests a flush would send now. Vanished nodes are dropped from the dirty set. */
	batches(): SaveBody[] {
		const nodes: NodeWire[] = [];
		for (const id of this.dirty) {
			const n = this.deps.getNode(id);
			if (n) nodes.push(n);
			else this.dirty.delete(id);
		}
		nodes.sort((a, b) => this.deps.depthOf(a.id) - this.deps.depthOf(b.id) || a.createdAt - b.createdAt);
		const out: SaveBody[] = [];
		let current: SaveBody = { upserts: [] };
		let size = bytes(current);
		for (const n of nodes) {
			const s = bytes(n) + 1;
			if (current.upserts.length > 0 && (current.upserts.length >= MAX_BATCH_NODES || size + s > MAX_BATCH_BYTES)) {
				out.push(current);
				current = { upserts: [] };
				size = bytes(current);
			}
			current.upserts.push(n);
			size += s;
		}
		if (this.viewDirty) current.view = this.deps.getView();
		if (current.upserts.length > 0 || current.view) out.push(current);
		return out;
	}

	flush({ keepalive = false }: { keepalive?: boolean } = {}): Promise<void> {
		if (keepalive) return this.flushKeepalive();
		if (this.inFlight) return this.inFlight;
		if (!this.deps.isOnline() || this.pending === 0) return Promise.resolve();
		this.inFlight = this.run().finally(() => (this.inFlight = null));
		return this.inFlight;
	}

	private async run(): Promise<void> {
		try {
			const batches = this.batches();
			// Move to in-flight before clearing dirty
			for (const b of batches) b.upserts.forEach((n) => this.inFlightIds.add(n.id));
			if (batches.some((b) => b.view)) this.inFlightView = true;
			this.dirty.clear();
			this.viewDirty = false;

			for (let i = 0; i < batches.length; i++) {
				try {
					await this.deps.put(batches[i], false);
					// Remove successfully sent ids from in-flight
					batches[i].upserts.forEach((n) => this.inFlightIds.delete(n.id));
					if (batches[i].view) this.inFlightView = false;
				} catch (error) {
					// Everything not yet confirmed goes back to dirty; changes made meanwhile are already there.
					for (const b of batches.slice(i)) {
						b.upserts.forEach((n) => this.dirty.add(n.id));
						if (b.view) this.viewDirty = true;
					}
					this.inFlightIds.clear();
					this.inFlightView = false;
					if (!isNetwork(error)) this.deps.onError(this.deps.failureMessage);
					return;
				}
			}
			this.deps.onError(null);
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

	/** Unload path: one request under the browser's keepalive cap; nothing is cleared. */
	private async flushKeepalive(): Promise<void> {
		// Candidates = dirty ∪ inFlight
		const candidates = new Set([...this.dirty, ...this.inFlightIds]);
		const first = this.deps.priority().filter((id) => candidates.has(id));
		const rest = [...candidates].filter((id) => !first.includes(id));

		const body: SaveBody = { upserts: [], ...(this.viewDirty || this.inFlightView ? { view: this.deps.getView() } : {}) };
		let size = bytes(body);
		const included = new Set<string>();
		const skipped = new Set<string>();

		// Walk candidates in priority order, then rest
		const walk = (id: string): string[] => {
			const chain: string[] = [];
			let current: string | null = id;
			while (current !== null) {
				if (included.has(current) || skipped.has(current) || !candidates.has(current)) break;
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
				const s = bytes(n) + 1;
				chainSize += s;
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

		if (body.upserts.length === 0 && !body.view) return;
		await this.deps.put(body, true).catch(() => {});
	}
}
