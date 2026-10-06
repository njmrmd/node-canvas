import { getContext, setContext, untrack } from 'svelte';
import { ApiCallError, apiFetch, type RateLimitSnapshot } from './api-client';
import { copy } from './copy';
import { TIMEOUT_ERROR, toNodeError } from './errors';
import {
	addNode,
	adoptPositions,
	appendText,
	appendThinking,
	canBranchFrom,
	canContinue,
	canRegenerate,
	canRetry,
	checkBranchSize,
	completeNode,
	CONTINUE_PROMPT,
	expandPath,
	extractBranch,
	failNode,
	graphStructure,
	interruptNode,
	moveNode,
	pathToRoot,
	resizeNode,
	restoreBranch,
	setBodyCollapsed,
	setCollapsed,
	settleOrphanedStreams,
	startStreaming,
	toMessages,
	visibleGraph,
	type ConversationGraph,
	type ConversationNode
} from './graph';
import {
	autoPlaceOnCreate,
	centeredRootPosition,
	NODE_HEIGHT_MAX,
	NODE_HEIGHT_MIN,
	NODE_WIDTH_DESKTOP,
	NODE_WIDTH_MAX,
	NODE_WIDTH_MIN,
	nodeWidthsFrom,
	reflowChildrenOnCreate,
	tidyLayout,
	type NodeHeights
} from './layout';
import { fromWire, toWire, type NodeWire, type ViewWire } from './node-wire';
import { Saver, type SaveBody } from './saver';
import { streamChat } from './stream';
import { StreamQueue, type Outcome } from './streams';
import type { Viewport } from './viewport';
import { MAX_MESSAGE_CHARS } from '../shared/chat-limits';
import type { ChatStreamEvent } from '../shared/chat-types';

type Point = { x: number; y: number };
export type CanvasInit = { nodes: NodeWire[]; view: ViewWire | null; model: string };

/** How long a delete can be undone (the old app's DELETE_UNDO_MS). One level only. */
export const UNDO_MS = 8000;

/** The last delete, for Undo. */
export type UndoState = {
	rootId: string;
	/** The removed nodes, parents first. Any that were mid-reply come back stopped, never spinning. */
	removed: ConversationNode[];
	/** The composer target the delete cleared, or null when the target was not in the branch. */
	clearedTarget: string | null;
};

export class CanvasStore {
	graph = $state.raw<ConversationGraph>({ nodesById: {}, nodeIds: [] });
	/**
	 * Changed only by Branch, send (Continue and Regenerate send too), New conversation, Enter on a
	 * focused card (Task 10), and deleting the target or an ancestor of it (then null; Undo puts it back).
	 */
	target = $state<string | null>(null);
	following = $state<string | null>(null);
	layoutVersion = $state(0);
	queueVersion = $state(0);
	model = $state('');
	rateLimit = $state<RateLimitSnapshot | null>(null);
	saveError = $state<string | null>(null);
	online = $state(true);
	undo = $state.raw<UndoState | null>(null);
	/** Children, and the cards a collapse hides — rebuilt only when the structure can have changed. */
	readonly structure = $derived.by(() => {
		void this.layoutVersion;
		return untrack(() => graphStructure(this.graph));
	});

	readonly width = NODE_WIDTH_DESKTOP;
	viewport: Viewport;
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a one-off snapshot, never observed
	measure: () => NodeHeights = () => new Map();
	visibleCenter: () => Point = () => ({ x: 0, y: 0 });

	private readonly streams: StreamQueue;
	private readonly saver: Saver;
	private readonly cleanups: (() => void)[] = [];
	private rateLimitReset: ReturnType<typeof setTimeout> | null = null;
	private undoTimer: ReturnType<typeof setTimeout> | null = null;

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
		if (this.undoTimer !== null) clearTimeout(this.undoTimer);
		this.undoTimer = null;
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

	/** Why nothing can be sent right now, whatever the target: offline, or out of messages. */
	get streamBlockedReason(): string | null {
		if (!this.online) return copy('composer.placeholder.offline');
		if (this.limitReached) return copy('composer.placeholder.rateLimited');
		return null;
	}

	get sendBlockedReason(): string | null {
		const blocked = this.streamBlockedReason;
		if (blocked) return blocked;
		const t = this.target ? this.graph.nodesById[this.target] : null;
		if (t && !canBranchFrom(t)) return copy(t.status === 'error' || t.status === 'interrupted' ? 'branch.failed' : 'branch.disabled');
		return null;
	}

	queuePosition(id: string): number | null {
		void this.queueVersion;
		return this.streams.position(id);
	}

	childCount(id: string): number {
		return this.structure.children.get(id)?.length ?? 0;
	}

	/** How many cards a collapse on `id` hides: everything below it, not only its direct replies. */
	hiddenBelow(id: string): number {
		const { children } = this.structure;
		const queue = [...(children.get(id) ?? [])];
		let count = 0;
		while (queue.length > 0) {
			count += 1;
			queue.push(...(children.get(queue.pop()!) ?? []));
		}
		return count;
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
		this.createAndStream(this.target, text);
		return true;
	}

	/** Continue: the rest of a stopped reply, asked for in a new card below it. */
	continueReply(id: string): void {
		const node = this.graph.nodesById[id];
		if (!node || !canContinue(node) || this.streamBlockedReason) return;
		this.createAndStream(id, CONTINUE_PROMPT);
	}

	/** Regenerate: the same prompt again, in a new card beside this one. */
	regenerate(id: string): void {
		if (!canRegenerate(this.graph, id) || this.streamBlockedReason) return;
		const node = this.graph.nodesById[id];
		this.createAndStream(node.parentId, node.prompt);
	}

	/** Retry: the same prompt again, into the same card, replacing the failed reply. */
	retry(id: string): void {
		if (!canRetry(this.graph, id) || this.streamBlockedReason) return;
		// Retry clears this card's text; a deleted reply to that text must not come back under it.
		if (this.undo?.removed[0]?.parentId === id) this.setUndo(null);
		const tooLong = checkBranchSize(toMessages(this.graph, id));
		if (tooLong) {
			this.commit(failNode(this.graph, id, { code: 'invalid_request', message: tooLong.message }));
			return;
		}
		this.commit(startStreaming(this.graph, id));
		this.following = id;
		this.enqueue(id);
	}

	/** A new card under `parentId` (a new root when null) asking `prompt`, streamed; the composer moves to it. */
	private createAndStream(parentId: string | null, prompt: string): string {
		// A reply to a card inside a collapsed subtree would be born hidden: show the way down first.
		let graph = parentId ? expandPath(this.graph, parentId) : this.graph;
		const heights = this.measure();
		const widths = nodeWidthsFrom(graph, this.width);
		const position = parentId
			? autoPlaceOnCreate(graph, parentId, this.width, heights, widths)
			: graph.nodeIds.length === 0
				? centeredRootPosition(this.visibleCenter(), this.width)
				: autoPlaceOnCreate(graph, null, this.width, heights, widths);
		const added = addNode(graph, { parentId, prompt, position, model: this.model });
		graph = parentId ? reflowChildrenOnCreate(added.graph, parentId, this.width, heights, widths) : added.graph;
		const id = added.node.id;
		const tooLong = checkBranchSize(toMessages(graph, id));
		graph = tooLong ? failNode(graph, id, { code: 'invalid_request', message: tooLong.message }) : startStreaming(graph, id);
		this.commit(graph);
		this.target = id;
		this.following = id;
		this.layoutVersion++;
		this.saver.markView();
		if (!tooLong) this.enqueue(id);
		return id;
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
		if (!node || node.status !== 'streaming') return; // a terminal frame already landed, or the card is gone
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

	/** Tidy lays out the cards that are drawn; hidden ones keep their place until their subtree opens. */
	tidy(): void {
		const laidOut = tidyLayout(visibleGraph(this.graph), this.width, this.measure(), nodeWidthsFrom(this.graph, this.width));
		this.commit(adoptPositions(this.graph, laidOut));
		this.layoutVersion++;
	}

	/** Hides or shows everything below a card. Showing lays the subtree out under it again. */
	toggleCollapsed(id: string): void {
		const node = this.graph.nodesById[id];
		if (!node || this.childCount(id) === 0) return;
		let graph = setCollapsed(this.graph, id, !node.collapsed);
		if (node.collapsed) graph = reflowChildrenOnCreate(graph, id, this.width, this.measure(), nodeWidthsFrom(graph, this.width));
		this.commit(graph);
		this.layoutVersion++;
	}

	/** One line instead of the whole card, or back. */
	toggleBodyCollapsed(id: string): void {
		const node = this.graph.nodesById[id];
		if (!node) return;
		this.commit(setBodyCollapsed(this.graph, id, !node.bodyCollapsed));
		this.layoutVersion++; // a resized card's flow node drops, or gets back, its fixed height
	}

	/** A card's new size (handle or keyboard), clamped to the old app's bounds; its replies re-centre under it. */
	resized(id: string, size: { width: number; height: number }): void {
		if (!this.graph.nodesById[id]) return;
		const clamped = {
			width: Math.round(Math.min(NODE_WIDTH_MAX, Math.max(NODE_WIDTH_MIN, size.width))),
			height: Math.round(Math.min(NODE_HEIGHT_MAX, Math.max(NODE_HEIGHT_MIN, size.height)))
		};
		let graph = resizeNode(this.graph, id, clamped);
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a local copy for one layout call, never observed
		const heights = new Map(this.measure());
		heights.set(id, clamped.height);
		graph = reflowChildrenOnCreate(graph, id, this.width, heights, nodeWidthsFrom(graph, this.width));
		this.commit(graph);
		this.layoutVersion++;
	}

	/** Deletes a card and everything below it. Undo can bring it back for `UNDO_MS`. */
	remove(id: string): void {
		if (!this.graph.nodesById[id]) return;
		const { graph, removed } = extractBranch(this.graph, id);
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a lookup local to this call, never observed
		const gone = new Set(removed.map((n) => n.id));
		this.commit(graph);
		// Only now that the graph has lost them, so the stopped streams find nothing to settle.
		for (const node of removed) if (node.status === 'streaming') this.streams.stop(node.id);
		const clearedTarget = this.target !== null && gone.has(this.target) ? this.target : null;
		if (clearedTarget) {
			this.target = null;
			this.saver.markView();
		}
		if (this.following && gone.has(this.following)) this.following = null;
		this.saver.markDeleted(id);
		this.setUndo({
			rootId: id,
			removed: removed.map((n) => (n.status === 'streaming' ? { ...n, status: 'interrupted' as const } : n)),
			clearedTarget
		});
		this.layoutVersion++;
	}

	/** Puts the last deleted branch back, and the composer target with it if nothing else took its place. */
	undoRemove(): void {
		const undo = this.undo;
		if (!undo) return;
		this.setUndo(null);
		const parentId = undo.removed[0]?.parentId ?? null;
		if (parentId !== null && !this.graph.nodesById[parentId]) return; // its parent is gone since: nothing to hang it on
		let graph = restoreBranch(this.graph, undo.removed);
		// Collapsed since the delete, the parent would hide the branch Undo brings back: open the way to it.
		if (parentId !== null) graph = expandPath(graph, parentId);
		this.saver.cancelDeletion(undo.rootId);
		this.commit(graph); // every restored node is new to the graph, so every one is saved again, parents first
		if (undo.clearedTarget && this.target === null) {
			this.target = undo.clearedTarget;
			this.saver.markView();
		}
		this.layoutVersion++;
	}

	private setUndo(undo: UndoState | null): void {
		if (this.undoTimer !== null) clearTimeout(this.undoTimer);
		this.undoTimer = undo ? setTimeout(() => this.setUndo(null), UNDO_MS) : null;
		this.undo = undo;
	}
}

const KEY = Symbol('canvas');
export const provideCanvas = (store: CanvasStore) => setContext(KEY, store);
export const useCanvas = () => getContext<CanvasStore>(KEY);
