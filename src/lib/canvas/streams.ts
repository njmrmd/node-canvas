/**
 * Runs at most `maxActive` replies at once, FIFO beyond that, with a
 * first-token watchdog. Knows nothing about graphs or HTTP: a Run gets an
 * abort signal and an `activity()` callback, and the queue reports how it ended.
 */
export type RunContext = { signal: AbortSignal; activity: () => void };
export type Run = (ctx: RunContext) => Promise<{ completed: boolean }>;
export type Outcome = { kind: 'completed' } | { kind: 'stopped' } | { kind: 'timed_out' } | { kind: 'failed'; error: unknown };

export const MAX_ACTIVE_STREAMS = 3;
export const FIRST_TOKEN_TIMEOUT_MS = 60_000;

type Clock = { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
type Active = { controller: AbortController; timer: ReturnType<typeof setTimeout> | null; timedOut: boolean; stopped: boolean };

export class StreamQueue {
	private queue: { id: string; run: Run }[] = [];
	private active = new Map<string, Active>();

	constructor(
		private readonly settle: (id: string, outcome: Outcome) => void,
		private readonly onChange: () => void = () => {},
		private readonly options = { maxActive: MAX_ACTIVE_STREAMS, firstTokenMs: FIRST_TOKEN_TIMEOUT_MS },
		private readonly clock: Clock = { setTimeout, clearTimeout }
	) {}

	enqueue(id: string, run: Run): void {
		this.queue.push({ id, run });
		this.pump();
		this.onChange();
	}

	/** 0-based place in the queue, or null when running or unknown. */
	position(id: string): number | null {
		const i = this.queue.findIndex((q) => q.id === id);
		return i === -1 ? null : i;
	}

	isActive(id: string): boolean {
		return this.active.has(id);
	}

	stop(id: string): void {
		const i = this.position(id);
		if (i !== null) {
			this.queue.splice(i, 1);
			this.onChange();
			this.settle(id, { kind: 'stopped' });
			return;
		}
		const entry = this.active.get(id);
		if (entry) {
			entry.stopped = true;
			entry.controller.abort();
		}
	}

	stopAll(): void {
		for (const { id } of [...this.queue]) this.stop(id);
		for (const id of [...this.active.keys()]) this.stop(id);
	}

	private pump(): void {
		while (this.active.size < this.options.maxActive && this.queue.length > 0) {
			const next = this.queue.shift()!;
			this.begin(next.id, next.run);
		}
	}

	private begin(id: string, run: Run): void {
		const entry: Active = { controller: new AbortController(), timer: null, timedOut: false, stopped: false };
		entry.timer = this.clock.setTimeout(() => {
			entry.timedOut = true;
			entry.controller.abort();
		}, this.options.firstTokenMs);
		this.active.set(id, entry);
		const activity = () => {
			if (entry.timer !== null) {
				this.clock.clearTimeout(entry.timer);
				entry.timer = null;
			}
		};
		run({ signal: entry.controller.signal, activity }).then(
			(result) =>
				this.finish(id, entry, entry.timedOut ? { kind: 'timed_out' } : result.completed && !entry.stopped ? { kind: 'completed' } : { kind: 'stopped' }),
			(error: unknown) =>
				this.finish(id, entry, entry.timedOut ? { kind: 'timed_out' } : entry.stopped ? { kind: 'stopped' } : { kind: 'failed', error })
		);
	}

	private finish(id: string, entry: Active, outcome: Outcome): void {
		if (entry.timer !== null) this.clock.clearTimeout(entry.timer);
		this.active.delete(id);
		this.settle(id, outcome);
		this.pump();
		this.onChange();
	}
}
