import { getContext, setContext, untrack } from 'svelte';
import { ApiCallError, apiFetch, type RateLimitSnapshot } from './api-client';
import { copy } from './copy';
import { TIMEOUT_ERROR, toNodeError } from './errors';
import {
	addNode,
	adoptPositions,
	appendText,
	appendThinking,
	branchBlockedKey,
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
	setNodeModel,
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
	/** The store's count of target choices at the delete: Undo puts `clearedTarget` back only if none came since. */
	targetChanges: number;
	/** The delete moved keyboard focus off the branch, so Undo gives it back to the restored card. */
	refocus: boolean;
};

/** A remembered on/off choice. Private mode or blocked storage just means it is not remembered. */
function readFlag(key: string, fallback: boolean): boolean {
	try {
		const value = localStorage.getItem(key);
		return value === null ? fallback : value === '1';
	} catch {
		return fallback;
	}
}

function writeFlag(key: string, value: boolean): void {
	try {
		localStorage.setItem(key, value ? '1' : '0');
	} catch {
		// the choice just won't persist
	}
}

export class CanvasStore {
	graph = $state.raw<ConversationGraph>({ nodesById: {}, nodeIds: [] });
	/**
	 * Changed only by Branch, send (Continue and Regenerate send too), New conversation, Enter on a
	 * focused card (Task 10), and deleting the target or an ancestor of it (then null; Undo puts it
	 * back if nothing else has changed it since).
	 */
	target = $state<string | null>(null);
	following = $state<string | null>(null);
	layoutVersion = $state(0);
	queueVersion = $state(0);
	model = $state('');
	// Raw: a snapshot is only ever replaced whole, and the reset timer must see the same object it was given.
	rateLimit = $state.raw<RateLimitSnapshot | null>(null);
	/** When the hourly window resets, in epoch milliseconds — the limit banner counts down to it. */
	rateLimitResetAt = $state<number | null>(null);
	saveError = $state<string | null>(null);
	online = $state(true);
	undo = $state.raw<UndoState | null>(null);
	/** Set by a reopen: the card whose subtree was laid out before all of its cards had been drawn and measured. */
	relayoutPending = $state<string | null>(null);
	/** Children, and the cards a collapse hides — rebuilt only when the structure can have changed. */
	readonly structure = $derived.by(() => {
		void this.layoutVersion;
		return untrack(() => graphStructure(this.graph));
	});
	/** Dim the cards off the root → target path (spec §4). On by default; `F` or the top-bar button toggles it. */
	focusPath = $state(readFlag('nc:focusPath', true));
	transcriptOpen = $state(false);
	shortcutsOpen = $state(false);
	/** The card keyboard commands act on — moved by arrows, Home and End, or a click. It is not the target. */
	focusedId = $state<string | null>(null);
	/** Bumped to ask the canvas to show `focusedId` and focus it, even when it is the same id again. */
	focusRequest = $state(0);
	/** Bumped to ask the composer to take the cursor (Enter or B on a card). */
	composerRequest = $state(0);

	/** The one tabbable card: the focused card, else the target, else the first root — never a hidden one. */
	readonly rovingId = $derived.by(() => {
		const { hidden, children } = this.structure;
		for (const id of [this.focusedId, this.target]) if (id && this.graph.nodesById[id] && !hidden.has(id)) return id;
		return children.get(null)?.[0] ?? null;
	});

	/** The root → target path, or null without a target. Rebuilt when the target or the structure changes, never per token. */
	readonly pathIds = $derived.by(() => {
		void this.layoutVersion;
		const target = this.target;
		return untrack(() =>
			target && this.graph.nodesById[target]
				? // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a snapshot rebuilt whole, never mutated
					new Set(pathToRoot(this.graph, target).map((n) => n.id))
				: null
		);
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
	/**
	 * How many times the user has chosen the target: Branch, a send, New conversation, Enter on a card.
	 * A delete clearing it and Undo restoring it are not choices, so they leave the count alone.
	 */
	private targetChanges = 0;

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
		const visibility = () => {
			if (document.visibilityState === 'hidden') void this.saver.flush({ keepalive: true });
			else this.checkLimit();
		};
		const pagehide = () => void this.saver.flush({ keepalive: true });
		addEventListener('online', online);
		addEventListener('offline', offline);
		document.addEventListener('visibilitychange', visibility);
		addEventListener('pagehide', pagehide);
		this.cleanups.push(
			() => removeEventListener('online', online),
			() => removeEventListener('offline', offline),
			() => document.removeEventListener('visibilitychange', visibility),
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
		const key = t ? branchBlockedKey(t) : null;
		return key ? copy(key) : null;
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
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a lookup local to this call, never observed
		const seen = new Set<string>();
		const queue = [...(children.get(id) ?? [])];
		while (queue.length > 0) {
			const next = queue.pop()!;
			if (seen.has(next)) continue; // only a corrupted, cyclic graph comes back round; graphStructure guards the same way
			seen.add(next);
			queue.push(...(children.get(next) ?? []));
		}
		return seen.size;
	}

	dimmed(id: string): boolean {
		return this.focusPath && this.pathIds !== null && !this.pathIds.has(id);
	}

	toggleFocusPath(): void {
		this.focusPath = !this.focusPath;
		writeFlag('nc:focusPath', this.focusPath);
	}

	/**
	 * Moves keyboard focus to a card; the canvas shows it and focuses it. Auto-follow stops: the reader is elsewhere.
	 * A card a collapse hides is not drawn, so focus goes to the collapsed card whose chip stands for it.
	 */
	focusCard(id: string): void {
		const { hidden } = this.structure;
		let at: string | null = id;
		// Bounded, so a corrupted, cyclic graph cannot hang the walk.
		for (let steps = 0; at !== null && hidden.has(at) && steps < this.graph.nodeIds.length; steps++) at = this.graph.nodesById[at]?.parentId ?? null;
		if (at === null || hidden.has(at) || !this.graph.nodesById[at]) return;
		this.focusedId = at;
		this.following = null;
		this.focusRequest++;
	}

	/** DOM focus landed on a card (a click or Tab): remember it, nothing more. */
	noteFocus(id: string): void {
		this.focusedId = id;
	}

	/** Enter on a focused card: the composer replies to it from now on, and takes the cursor. */
	bindComposer(id: string): void {
		if (!this.graph.nodesById[id]) return;
		this.target = id;
		this.targetChanges++;
		this.saver.markView();
		this.composerRequest++;
	}

	/** `B`: what the card's Branch button does, then the cursor goes to the composer. */
	branchFromCard(id: string): void {
		const node = this.graph.nodesById[id];
		if (!node || !canBranchFrom(node)) return;
		this.branch(id);
		this.composerRequest++;
	}

	/** Alt+arrows: moves a card by hand, so Tidy leaves it where it is put. */
	nudge(id: string, dx: number, dy: number): void {
		const node = this.graph.nodesById[id];
		if (!node) return;
		this.commit(moveNode(this.graph, id, { x: node.position.x + dx, y: node.position.y + dy }));
		this.layoutVersion++;
	}

	/** Cmd/Ctrl+Alt+arrows: grows or shrinks a card from its current size. */
	resizeBy(id: string, dw: number, dh: number): void {
		const node = this.graph.nodesById[id];
		if (!node || node.bodyCollapsed) return;
		const current = node.size ?? { width: this.width, height: this.measure().get(id) ?? NODE_HEIGHT_MIN };
		this.resized(id, { width: current.width + dw, height: current.height + dh });
	}

	branch(id: string): void {
		this.target = id;
		this.targetChanges++;
		this.saver.markView();
	}

	newConversation(): void {
		this.target = null;
		this.targetChanges++;
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
		// A card stores the model it was sent with, and the card's own failure says that model is gone: send it with
		// the one chosen now, or Retry would ask for the same model again.
		const gone = this.graph.nodesById[id].error?.code === 'unsupported_model';
		this.commit(startStreaming(gone ? setNodeModel(this.graph, id, this.model) : this.graph, id));
		this.following = id;
		this.enqueue(id);
	}

	/** Opens every collapsed card on the way down to `id`, and lays the opened subtree out under the topmost one.
	 * The chip, a send and Undo all reopen through here, so they lay a subtree out alike. */
	private openTo(graph: ConversationGraph, id: string): ConversationGraph {
		const top = pathToRoot(graph, id).find((n) => n.collapsed);
		if (!top) return graph;
		const opened = expandPath(graph, id);
		// Cards never drawn in this session (after a reload, say) have no height yet: lay the subtree out again once they do.
		this.relayoutPending = top.id;
		return reflowChildrenOnCreate(opened, top.id, this.width, this.measure(), nodeWidthsFrom(opened, this.width));
	}

	/** A new card under `parentId` (a new root when null) asking `prompt`, streamed; the composer moves to it. */
	private createAndStream(parentId: string | null, prompt: string): string {
		// A reply to a card inside a collapsed subtree would be born hidden: show the way down first.
		let graph = parentId ? this.openTo(this.graph, parentId) : this.graph;
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
		this.targetChanges++;
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
		this.rateLimitResetAt = Date.now() + snapshot.resetSeconds * 1000;
		if (this.rateLimitReset !== null) clearTimeout(this.rateLimitReset);
		this.rateLimitReset = null;
		if (snapshot.remaining === 0) {
			// Every call clears the previous timer, so a timer that fires belongs to the current snapshot.
			this.rateLimitReset = setTimeout(() => this.endLimit(), snapshot.resetSeconds * 1000);
		}
	}

	/** Ends the limit if its window is already over — after a sleep, or when timers were throttled in a background tab. */
	checkLimit(now = Date.now()): void {
		if (this.limitReached && this.rateLimitResetAt !== null && now >= this.rateLimitResetAt) this.endLimit();
	}

	/** The hourly window is over: the budget is back, and the banner and the block go. */
	private endLimit(): void {
		if (this.rateLimitReset !== null) clearTimeout(this.rateLimitReset);
		this.rateLimitReset = null;
		if (this.rateLimit && this.rateLimit.remaining === 0) this.rateLimit = { ...this.rateLimit, remaining: this.rateLimit.limit };
	}

	private apply(id: string, event: ChatStreamEvent): void {
		if (event.type === 'ping') return; // the model started; onEvent already called activity()
		if (!this.graph.nodesById[id]) return;
		if (event.type === 'text') this.commit(appendText(this.graph, id, event.text));
		else if (event.type === 'thinking') this.commit(appendThinking(this.graph, id, event.text));
		else if (event.type === 'done') this.commit(completeNode(this.graph, id, event.usage));
		else if (event.type === 'error') this.commit(failNode(this.graph, id, { code: event.code, message: event.message }));
		// Any other type is one a newer server sends and this page does not know: it does nothing. A bare
		// `else` would fail the card, as Plan 2's did on the `ping` frame.
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
		const graph = node.collapsed ? this.openTo(this.graph, id) : setCollapsed(this.graph, id, true);
		this.commit(graph);
		this.layoutVersion++;
	}

	/** The canvas calls this once the reopened cards are measured: the subtree is laid out once more, with real heights. */
	relayoutReopened(): void {
		const id = this.relayoutPending;
		this.relayoutPending = null;
		if (!id || !this.graph.nodesById[id] || this.graph.nodesById[id].collapsed) return;
		this.commit(reflowChildrenOnCreate(this.graph, id, this.width, this.measure(), nodeWidthsFrom(this.graph, this.width)));
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
		const refocus = this.focusedId !== null && gone.has(this.focusedId);
		if (refocus) {
			const parentId = removed[0].parentId;
			if (parentId) this.focusCard(parentId);
			else this.focusedId = null;
		}
		this.saver.markDeleted(id);
		this.setUndo({
			rootId: id,
			removed: removed.map((n) => (n.status === 'streaming' ? { ...n, status: 'interrupted' as const } : n)),
			clearedTarget,
			targetChanges: this.targetChanges,
			refocus
		});
		this.layoutVersion++;
	}

	/** Puts the last deleted branch back, and the composer target with it if nothing else has changed the target since. */
	undoRemove(): void {
		const undo = this.undo;
		if (!undo) return;
		this.setUndo(null);
		const parentId = undo.removed[0]?.parentId ?? null;
		if (parentId !== null && !this.graph.nodesById[parentId]) return; // its parent is gone since: nothing to hang it on
		let graph = restoreBranch(this.graph, undo.removed);
		// Collapsed since the delete, the parent would hide the branch Undo brings back: open the way to it.
		if (parentId !== null) graph = this.openTo(graph, parentId);
		this.saver.cancelDeletion(undo.rootId);
		this.commit(graph); // every restored node is new to the graph, so every one is saved again, parents first
		// A target chosen since the delete, even New conversation, is the user's choice: Undo must not override it.
		if (undo.clearedTarget && this.target === null && this.targetChanges === undo.targetChanges) {
			this.target = undo.clearedTarget;
			this.saver.markView();
		}
		this.layoutVersion++;
		// After the bump, so the structure focusCard reads already has the restored cards.
		if (undo.refocus) this.focusCard(undo.rootId);
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
