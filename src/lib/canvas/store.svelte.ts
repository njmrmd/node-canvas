import { getContext, setContext } from 'svelte';
import { ApiCallError, apiFetch, type RateLimitSnapshot } from './api-client';
import { copy } from './copy';
import { TIMEOUT_ERROR, toNodeError } from './errors';
import {
	addNode,
	appendText,
	appendThinking,
	canBranchFrom,
	checkBranchSize,
	completeNode,
	failNode,
	interruptNode,
	moveNode,
	pathToRoot,
	settleOrphanedStreams,
	startStreaming,
	toMessages,
	type ConversationGraph
} from './graph';
import { autoPlaceOnCreate, centeredRootPosition, NODE_WIDTH_DESKTOP, reflowChildrenOnCreate, tidyLayout, type NodeHeights } from './layout';
import { fromWire, toWire, type NodeWire, type ViewWire } from './node-wire';
import { Saver, type SaveBody } from './saver';
import { streamChat } from './stream';
import { StreamQueue, type Outcome } from './streams';
import type { Viewport } from './viewport';
import { MAX_MESSAGE_CHARS } from '../shared/chat-limits';
import type { ChatStreamEvent } from '../shared/chat-types';

type Point = { x: number; y: number };
export type CanvasInit = { nodes: NodeWire[]; view: ViewWire | null; model: string };

export class CanvasStore {
	graph = $state.raw<ConversationGraph>({ nodesById: {}, nodeIds: [] });
	/** Changed only by Branch, send, New conversation (Plan 3 adds Enter-on-focus and delete). */
	target = $state<string | null>(null);
	following = $state<string | null>(null);
	layoutVersion = $state(0);
	queueVersion = $state(0);
	model = $state('');
	rateLimit = $state<RateLimitSnapshot | null>(null);
	saveError = $state<string | null>(null);
	online = $state(true);

	readonly width = NODE_WIDTH_DESKTOP;
	viewport: Viewport;
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a one-off snapshot, never observed
	measure: () => NodeHeights = () => new Map();
	visibleCenter: () => Point = () => ({ x: 0, y: 0 });

	private readonly streams: StreamQueue;
	private readonly saver: Saver;
	private readonly cleanups: (() => void)[] = [];
	private rateLimitReset: ReturnType<typeof setTimeout> | null = null;

	constructor(init: CanvasInit) {
		const loaded = fromWire(init.nodes);
		const settled = settleOrphanedStreams(loaded);
		this.graph = settled;
		this.model = init.model;
		this.viewport = init.view?.viewport ?? { x: 0, y: 0, zoom: 1 };
		const t = init.view?.targetNodeId;
		this.target = t && settled.nodesById[t] ? t : null;
		this.streams = new StreamQueue((id, outcome) => this.settle(id, outcome), () => this.queueVersion++);
		this.saver = new Saver({
			getNode: (id) => (this.graph.nodesById[id] ? toWire(this.graph.nodesById[id]) : null),
			depthOf: (id) => (this.graph.nodesById[id] ? pathToRoot(this.graph, id).length : 0),
			getView: () => ({ viewport: this.viewport, targetNodeId: this.target }),
			put: (body: SaveBody, keepalive: boolean) => apiFetch<{ rejected: string[] }>('/api/nodes', { method: 'PUT', body, keepalive }),
			remove: (id: string, keepalive: boolean) => apiFetch<void>(`/api/nodes/${id}`, { method: 'DELETE', keepalive }),
			isOnline: () => this.online,
			onError: (message) => (this.saveError = message),
			priority: () => this.graph.nodeIds.filter((id) => this.graph.nodesById[id].status === 'streaming'),
			failureMessage: copy('save.failed.banner')
		});
		// Streams orphaned by a reload settle to "interrupted" — save that back.
		for (const id of settled.nodeIds) if (settled.nodesById[id] !== loaded.nodesById[id]) this.saver.markNode(id);
	}

	start(): void {
		this.online = navigator.onLine;
		const online = () => {
			this.online = true;
			void this.saver.flush();
		};
		const offline = () => (this.online = false);
		const hidden = () => {
			if (document.visibilityState === 'hidden') void this.saver.flush({ keepalive: true });
		};
		const pagehide = () => void this.saver.flush({ keepalive: true });
		addEventListener('online', online);
		addEventListener('offline', offline);
		document.addEventListener('visibilitychange', hidden);
		addEventListener('pagehide', pagehide);
		this.cleanups.push(
			() => removeEventListener('online', online),
			() => removeEventListener('offline', offline),
			() => document.removeEventListener('visibilitychange', hidden),
			() => removeEventListener('pagehide', pagehide)
		);
		this.saver.start();
	}

	dispose(): void {
		this.streams.stopAll();
		// An in-app link leaves without pagehide or visibilitychange, and the page's JS lives on, so a
		// normal flush (no keepalive cap) saves what changed since the last tick.
		void this.saver.flush();
		this.cleanups.forEach((f) => f());
		this.saver.stop();
		if (this.rateLimitReset !== null) clearTimeout(this.rateLimitReset);
		this.rateLimitReset = null;
	}

	/** Replace the graph and mark every node object that changed. */
	private commit(next: ConversationGraph): void {
		const prev = this.graph;
		this.graph = next;
		for (const id of next.nodeIds) if (next.nodesById[id] !== prev.nodesById[id]) this.saver.markNode(id);
	}

	label(id: string | null): string {
		if (!id) return copy('composer.newConversation');
		const prompt = this.graph.nodesById[id]?.prompt ?? '';
		return prompt.length > 32 ? `“${prompt.slice(0, 31)}…”` : `“${prompt}”`;
	}

	get limitReached(): boolean {
		return this.rateLimit !== null && this.rateLimit.remaining === 0;
	}

	get sendBlockedReason(): string | null {
		if (!this.online) return copy('composer.placeholder.offline');
		if (this.limitReached) return copy('composer.placeholder.rateLimited');
		const t = this.target ? this.graph.nodesById[this.target] : null;
		if (t && !canBranchFrom(t)) return copy(t.status === 'error' || t.status === 'interrupted' ? 'branch.failed' : 'branch.disabled');
		return null;
	}

	queuePosition(id: string): number | null {
		void this.queueVersion;
		return this.streams.position(id);
	}

	branch(id: string): void {
		this.target = id;
		this.saver.markView();
	}

	newConversation(): void {
		this.target = null;
		this.saver.markView();
	}

	setModel(id: string): void {
		this.model = id;
		try {
			localStorage.setItem('nc:model', id);
		} catch {
			// private mode or blocked storage: the choice just won't persist
		}
	}

	setViewport(viewport: Viewport): void {
		this.viewport = viewport;
		this.saver.markView();
	}

	/** False when nothing was sent: the composer keeps the draft. */
	send(prompt: string): boolean {
		const text = prompt.trim();
		// Over the cap the server refuses to save the node, so none is created; the composer says why.
		if (!text || text.length > MAX_MESSAGE_CHARS || this.sendBlockedReason) return false;
		const parentId = this.target;
		const heights = this.measure();
		const position = parentId
			? autoPlaceOnCreate(this.graph, parentId, this.width, heights)
			: this.graph.nodeIds.length === 0
				? centeredRootPosition(this.visibleCenter(), this.width)
				: autoPlaceOnCreate(this.graph, null, this.width, heights);
		const added = addNode(this.graph, { parentId, prompt: text, position, model: this.model });
		let graph = parentId ? reflowChildrenOnCreate(added.graph, parentId, this.width, heights) : added.graph;
		const id = added.node.id;
		const tooLong = checkBranchSize(toMessages(graph, id));
		graph = tooLong ? failNode(graph, id, { code: 'invalid_request', message: tooLong.message }) : startStreaming(graph, id);
		this.commit(graph);
		this.target = id;
		this.following = id;
		this.layoutVersion++;
		this.saver.markView();
		if (!tooLong) this.enqueue(id);
		return true;
	}

	private enqueue(id: string): void {
		const model = this.graph.nodesById[id].model ?? this.model;
		this.streams.enqueue(id, ({ signal, activity }) =>
			streamChat({
				model,
				messages: toMessages(this.graph, id),
				signal,
				onEvent: (event) => {
					activity();
					this.apply(id, event);
				},
				onRateLimit: (snapshot) => this.noteRateLimit(snapshot)
			})
		);
	}

	private noteRateLimit(snapshot: RateLimitSnapshot): void {
		this.rateLimit = snapshot;
		if (this.rateLimitReset !== null) clearTimeout(this.rateLimitReset);
		this.rateLimitReset = null;
		if (snapshot.remaining === 0) {
			this.rateLimitReset = setTimeout(() => {
				this.rateLimitReset = null;
				if (this.rateLimit === snapshot) this.rateLimit = { ...snapshot, remaining: snapshot.limit };
			}, snapshot.resetSeconds * 1000);
		}
	}

	private apply(id: string, event: ChatStreamEvent): void {
		if (event.type === 'ping') return; // the model started; onEvent already called activity()
		if (!this.graph.nodesById[id]) return;
		if (event.type === 'text') this.commit(appendText(this.graph, id, event.text));
		else if (event.type === 'thinking') this.commit(appendThinking(this.graph, id, event.text));
		else if (event.type === 'done') this.commit(completeNode(this.graph, id, event.usage));
		else this.commit(failNode(this.graph, id, { code: event.code, message: event.message }));
	}

	private settle(id: string, outcome: Outcome): void {
		const node = this.graph.nodesById[id];
		if (!node || node.status !== 'streaming') return; // a terminal frame already landed
		if (outcome.kind === 'stopped') this.commit(interruptNode(this.graph, id));
		else if (outcome.kind === 'timed_out') this.commit(failNode(this.graph, id, TIMEOUT_ERROR));
		else if (outcome.kind === 'failed') {
			// A body that breaks after the reply opened is a dropped connection — which is also what the
			// browser does to every open stream as a tab reloads or closes, just before `pagehide`. Keep
			// the partial reply as "Stopped" (interruptNode's contract). Failures the server reports
			// arrive as an ApiCallError or an `error` frame and stay errors.
			this.commit(outcome.error instanceof ApiCallError ? failNode(this.graph, id, toNodeError(outcome.error)) : interruptNode(this.graph, id));
		}
	}

	stop(id: string): void {
		this.streams.stop(id);
	}

	moved(id: string, position: Point): void {
		this.commit(moveNode(this.graph, id, position));
	}

	tidy(): void {
		this.commit(tidyLayout(this.graph, this.width, this.measure()));
		this.layoutVersion++;
	}
}

const KEY = Symbol('canvas');
export const provideCanvas = (store: CanvasStore) => setContext(KEY, store);
export const useCanvas = () => getContext<CanvasStore>(KEY);
