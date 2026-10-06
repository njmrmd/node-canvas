import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { StreamQueue, type Outcome, type RunContext } from './streams';

function fakeClock() {
	let next = 1;
	const timers = new Map<number, () => void>();
	return {
		clock: {
			setTimeout: ((fn: () => void) => {
				const id = next++;
				timers.set(id, fn);
				return id;
			}) as unknown as typeof setTimeout,
			clearTimeout: ((id: number) => timers.delete(id)) as unknown as typeof clearTimeout
		},
		fireAll: () => [...timers.entries()].forEach(([id, fn]) => (timers.delete(id), fn())),
		pending: () => timers.size
	};
}

function controllable() {
	let resolve!: (r: { completed: boolean }) => void;
	let reject!: (e: unknown) => void;
	let ctx!: RunContext;
	const promise = new Promise<{ completed: boolean }>((res, rej) => ((resolve = res), (reject = rej)));
	return { run: (c: RunContext) => ((ctx = c), promise), resolve, reject, ctx: () => ctx };
}

const tick = () => new Promise((r) => setImmediate(r));

describe('StreamQueue', () => {
	it('runs three at a time and queues the rest in order', async () => {
		const settled: [string, Outcome][] = [];
		const q = new StreamQueue((id, o) => settled.push([id, o]), undefined, undefined, fakeClock().clock);
		const runs = ['a', 'b', 'c', 'd', 'e'].map((id) => [id, controllable()] as const);
		for (const [id, r] of runs) q.enqueue(id, r.run);
		assert.deepEqual(['a', 'b', 'c'].map((id) => q.isActive(id)), [true, true, true]);
		assert.equal(q.position('d'), 0);
		assert.equal(q.position('e'), 1);
		runs[0][1].resolve({ completed: true });
		await tick();
		assert.deepEqual(settled, [['a', { kind: 'completed' }]]);
		assert.equal(q.isActive('d'), true);
		assert.equal(q.position('e'), 0);
	});

	it('stopping a queued stream removes it without running it', async () => {
		const settled: string[] = [];
		const q = new StreamQueue((id, o) => settled.push(`${id}:${o.kind}`), undefined, { maxActive: 1, firstTokenMs: 60_000 }, fakeClock().clock);
		const a = controllable();
		let bRan = false;
		q.enqueue('a', a.run);
		q.enqueue('b', async () => ((bRan = true), { completed: true }));
		q.stop('b');
		assert.deepEqual(settled, ['b:stopped']);
		a.resolve({ completed: true });
		await tick();
		assert.equal(bRan, false);
	});

	it('stopping an active stream aborts it and settles as stopped', async () => {
		const settled: string[] = [];
		const q = new StreamQueue((id, o) => settled.push(`${id}:${o.kind}`), undefined, undefined, fakeClock().clock);
		const a = controllable();
		q.enqueue('a', a.run);
		q.stop('a');
		assert.equal(a.ctx().signal.aborted, true);
		a.resolve({ completed: false });
		await tick();
		assert.deepEqual(settled, ['a:stopped']);
	});

	it('times out a stream that produces nothing, but not one that has started', async () => {
		const settled: string[] = [];
		const c = fakeClock();
		const q = new StreamQueue((id, o) => settled.push(`${id}:${o.kind}`), undefined, undefined, c.clock);
		const silent = controllable();
		const talking = controllable();
		q.enqueue('silent', silent.run);
		q.enqueue('talking', talking.run);
		talking.ctx().activity();
		c.fireAll();
		assert.equal(silent.ctx().signal.aborted, true);
		assert.equal(talking.ctx().signal.aborted, false);
		silent.resolve({ completed: false });
		await tick();
		assert.deepEqual(settled, ['silent:timed_out']);
	});

	it('reports a thrown run as failed with its error', async () => {
		let outcome: Outcome | undefined;
		const q = new StreamQueue((_id, o) => (outcome = o), undefined, undefined, fakeClock().clock);
		const a = controllable();
		q.enqueue('a', a.run);
		const boom = new Error('boom');
		a.reject(boom);
		await tick();
		assert.deepEqual(outcome, { kind: 'failed', error: boom });
	});

	it('works with default clock (no `this` binding required)', async () => {
		const q = new StreamQueue(() => {}, undefined);
		const settled: Outcome[] = [];
		(q as unknown as { settle: (id: string, o: Outcome) => void }).settle = (_id, o) => settled.push(o);
		q.enqueue('a', async () => ({ completed: true }));
		await tick();
		assert.equal(settled.length, 1);
		assert.deepEqual(settled[0], { kind: 'completed' });
	});

	it('default clock functions do not reference `this`', () => {
		const q = new StreamQueue(() => {}, undefined);
		const clock = (q as unknown as { clock: { setTimeout: (fn: () => void, ms: number) => unknown; clearTimeout: (id: unknown) => void } }).clock;

		// Test setTimeout doesn't need `this` - should not throw
		const setTimeoutId = Reflect.apply(clock.setTimeout, {}, [() => {}, 1]);
		// Test clearTimeout doesn't need `this` - should not throw
		Reflect.apply(clock.clearTimeout, {}, [setTimeoutId]);
		assert.ok(true);
	});

	it('allows re-enqueuing the same id before old run settles', async () => {
		const settled: [string, Outcome][] = [];
		const q = new StreamQueue((id, o) => settled.push([id, o]), undefined, undefined, fakeClock().clock);
		const oldRun = controllable();
		const newRun = controllable();
		q.enqueue('a', oldRun.run);
		q.stop('a');
		q.enqueue('a', newRun.run);
		assert.equal(q.isActive('a'), true);
		oldRun.resolve({ completed: false });
		await tick();
		assert.deepEqual(settled, [['a', { kind: 'stopped' }]]);
		assert.equal(q.isActive('a'), true);
		newRun.resolve({ completed: true });
		await tick();
		assert.deepEqual(settled, [['a', { kind: 'stopped' }], ['a', { kind: 'completed' }]]);
	});
});
