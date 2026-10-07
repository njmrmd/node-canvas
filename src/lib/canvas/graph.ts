import type { ChatMessage } from "../shared/chat-types";
import type { NodeErrorCode } from "../shared/error-codes";
import {
  MAX_MESSAGES as MAX_BRANCH_MESSAGES,
  MAX_MESSAGE_CHARS,
  MAX_TOTAL_CHARS as MAX_BRANCH_CHARS,
} from "../shared/chat-limits";

/**
 * The conversation graph — the data model underneath the canvas.
 *
 * **A node is one exchange: a prompt and the answer to it.** Not one message.
 * The alternative (a node per message) was rejected because it doubles the
 * cards on the canvas, and because it makes "branch from here" ambiguous —
 * branching from a user node and branching from the assistant node below it
 * would mean different things for no gain the user can see.
 *
 * An edge means "the parent exchange is context for this one". The path from
 * a root down to a node is exactly what gets sent to the model for that node,
 * which is what `toMessages` produces.
 *
 * Every mutation returns a new graph and leaves the input untouched, so the
 * store can hold it in `$state.raw` and replace it whole. Node objects are
 * shared by reference where they did not change, so a card only re-renders
 * when its own node did.
 */

/** The caps `POST /api/chat` enforces, imported so the canvas checks the same numbers. */
export { MAX_BRANCH_MESSAGES, MAX_MESSAGE_CHARS, MAX_BRANCH_CHARS };

export type NodeStatus =
  /** Created, prompt written, nothing requested yet. */
  | "draft"
  /** A request is open; `response`/`thinking` are growing. */
  | "streaming"
  /** A `done` frame arrived. */
  | "complete"
  /** The user stopped it, or the connection dropped. Partial text is kept. */
  | "interrupted"
  /** A terminal `error` frame, or a failure before the stream opened. */
  | "error";

export type NodeError = {
  code: NodeErrorCode;
  /** Already written for a person — safe to render verbatim. */
  message: string;
};

export type Point = { x: number; y: number };

export type Size = { width: number; height: number };

/** §1.1: `auto` nodes are re-placed by Tidy; a dragged node becomes `manual`
 *  and Tidy never touches it again. */
export type PositionMode = "auto" | "manual";

export type ConversationNode = {
  id: string;
  /** `null` for a root. A graph may hold several roots. */
  parentId: string | null;
  prompt: string;
  /** The visible answer, appended to as `text` frames arrive. */
  response: string;
  /** Summarized reasoning. Never the answer — render it de-emphasised. */
  thinking: string;
  status: NodeStatus;
  error: NodeError | null;
  position: Point;
  positionMode: PositionMode;
  /** TES-90: a user-dragged size, same idea as `position`/`positionMode` — a
   * property of the node, persisted the same way. `null` means "not resized":
   * the card uses the viewport's default width and sizes its height to its
   * content, exactly like before this field existed. */
  size: Size | null;
  /** §4.9: subtree hidden below this node, chevron shows a count instead. */
  collapsed: boolean;
  /** TES-90: this card's own body collapsed to one line — independent of
   * `collapsed`, which hides descendants instead. */
  bodyCollapsed: boolean;
  usage: { inputTokens: number; outputTokens: number } | null;
  /** The model that answered (or will answer) this exchange. */
  model: string | null;
  createdAt: number;
  updatedAt: number;
};

export type ConversationGraph = {
  nodesById: Readonly<Record<string, ConversationNode>>;
  /** Creation order (an Undo puts a branch back by `createdAt`); parents always before their children. */
  nodeIds: readonly string[];
};

export function createGraph(): ConversationGraph {
  return { nodesById: {}, nodeIds: [] };
}

export function getNode(
  graph: ConversationGraph,
  nodeId: string,
): ConversationNode | null {
  return graph.nodesById[nodeId] ?? null;
}

/** Throws rather than returning null — callers that pass an unknown id are buggy. */
function requireNode(
  graph: ConversationGraph,
  nodeId: string,
): ConversationNode {
  const node = graph.nodesById[nodeId];
  if (!node) throw new Error(`No such node: ${nodeId}`);
  return node;
}

export function rootIds(graph: ConversationGraph): string[] {
  return graph.nodeIds.filter((id) => graph.nodesById[id].parentId === null);
}

export function childIds(graph: ConversationGraph, nodeId: string): string[] {
  return graph.nodeIds.filter((id) => graph.nodesById[id].parentId === nodeId);
}

export function isEmpty(graph: ConversationGraph): boolean {
  return graph.nodeIds.length === 0;
}

/**
 * Root → node, inclusive. Cycles cannot be created through this module's API,
 * but a corrupted persisted graph could carry one, so the walk is bounded and
 * throws instead of hanging the canvas.
 */
export function pathToRoot(
  graph: ConversationGraph,
  nodeId: string,
): ConversationNode[] {
  const path: ConversationNode[] = [];
  const seen = new Set<string>();

  let current: ConversationNode | null = requireNode(graph, nodeId);
  while (current) {
    if (seen.has(current.id)) {
      throw new Error(`Cycle in conversation graph at ${current.id}`);
    }
    seen.add(current.id);
    path.push(current);
    current = current.parentId ? requireNode(graph, current.parentId) : null;
  }

  return path.reverse();
}

/** The node and everything beneath it, parents before children. */
export function descendantIds(
  graph: ConversationGraph,
  nodeId: string,
): string[] {
  const collected: string[] = [];
  const queue = [nodeId];

  while (queue.length > 0) {
    const id = queue.shift()!;
    collected.push(id);
    queue.push(...childIds(graph, id));
  }

  return collected;
}

/**
 * Whether a new branch may hang off this node.
 *
 * A node with no answer yet cannot be a parent: its exchange would contribute
 * a user turn with no assistant turn after it, breaking the alternation the
 * chat route requires. Blocking it here is what makes `toMessages` total —
 * it can never assemble a branch the server will reject.
 *
 * An interrupted or failed node with partial text *is* branchable. The user
 * saw that text; it is real context.
 */
export function canBranchFrom(node: ConversationNode): boolean {
  return node.response.trim() !== "";
}

/**
 * Why a branch cannot hang off this node, as a copy key — only a reply still on
 * its way will finish. Null when it can.
 */
export function branchBlockedKey(
  node: ConversationNode,
): "branch.disabled" | "branch.failed" | null {
  if (canBranchFrom(node)) return null;
  return node.status === "streaming" ? "branch.disabled" : "branch.failed";
}

/** What Continue sends: the model picks up an interrupted reply, in a new card below it (the old app's wording). */
export const CONTINUE_PROMPT = "Continue from where you left off.";

export type GraphStructure = {
  /** Parent id → child ids in creation order; roots are listed under `null`. */
  children: ReadonlyMap<string | null, readonly string[]>;
  /** Ids under a collapsed node: not drawn. A collapsed node itself is drawn. */
  hidden: ReadonlySet<string>;
};

/** Children and the hidden set in one pass, for callers that would otherwise ask per node. */
export function graphStructure(graph: ConversationGraph): GraphStructure {
  const children = new Map<string | null, string[]>();
  for (const id of graph.nodeIds) {
    const parent = graph.nodesById[id].parentId;
    const list = children.get(parent);
    if (list) list.push(id);
    else children.set(parent, [id]);
  }
  const hidden = new Set<string>();
  const hide = (id: string) => {
    for (const child of children.get(id) ?? []) {
      if (hidden.has(child)) continue;
      hidden.add(child);
      hide(child);
    }
  };
  for (const id of graph.nodeIds) if (graph.nodesById[id].collapsed) hide(id);
  return { children, hidden };
}

export function hiddenIds(graph: ConversationGraph): ReadonlySet<string> {
  return graphStructure(graph).hidden;
}

/** The graph without its hidden nodes: what the canvas draws, and what Tidy lays out. */
export function visibleGraph(graph: ConversationGraph): ConversationGraph {
  const { hidden } = graphStructure(graph);
  if (hidden.size === 0) return graph;
  const nodeIds = graph.nodeIds.filter((id) => !hidden.has(id));
  const nodesById: Record<string, ConversationNode> = {};
  for (const id of nodeIds) nodesById[id] = graph.nodesById[id];
  return { nodesById, nodeIds };
}

/** Copies positions from a laid-out copy (e.g. `tidyLayout(visibleGraph(g))`) back into the full graph. */
export function adoptPositions(
  graph: ConversationGraph,
  from: ConversationGraph,
  now?: number,
): ConversationGraph {
  let next = graph;
  for (const id of from.nodeIds) {
    const current = graph.nodesById[id];
    const position = from.nodesById[id].position;
    if (current && (current.position.x !== position.x || current.position.y !== position.y)) {
      next = placeNode(next, id, position, now);
    }
  }
  return next;
}

/** Expands every collapsed node from the root down to `nodeId`, inclusive, so a new child of it is drawn. */
export function expandPath(graph: ConversationGraph, nodeId: string, now?: number): ConversationGraph {
  let next = graph;
  for (const node of pathToRoot(graph, nodeId)) {
    if (node.collapsed) next = setCollapsed(next, node.id, false, now);
  }
  return next;
}

/** Takes a node and its subtree out, and returns what it took (parents first) so Undo can put it back. */
export function extractBranch(
  graph: ConversationGraph,
  nodeId: string,
): { graph: ConversationGraph; removed: ConversationNode[] } {
  requireNode(graph, nodeId);
  const removed = descendantIds(graph, nodeId).map((id) => graph.nodesById[id]);
  return { graph: removeBranch(graph, nodeId), removed };
}

/** Puts an extracted branch back, every node as it was, in creation order. */
export function restoreBranch(
  graph: ConversationGraph,
  removed: readonly ConversationNode[],
): ConversationGraph {
  if (removed.length === 0) return graph;
  const parentId = removed[0].parentId;
  if (parentId !== null && !graph.nodesById[parentId]) {
    throw new Error(`Cannot restore under ${parentId}: it is gone.`);
  }
  const nodesById: Record<string, ConversationNode> = { ...graph.nodesById };
  for (const node of removed) {
    if (nodesById[node.id]) throw new Error(`Cannot restore ${node.id}: it is already on the canvas.`);
    nodesById[node.id] = node;
  }
  // Sorted by creation time. On a tie a remaining node stays before a restored one, and restored
  // nodes keep their parents-first order, so a parent always precedes its children.
  const nodeIds = [...graph.nodeIds, ...removed.map((n) => n.id)].sort(
    (a, b) => nodesById[a].createdAt - nodesById[b].createdAt,
  );
  return { nodesById, nodeIds };
}

/**
 * Retry sends the same prompt again into the same card. Not once the card has
 * replies: they were answered against the text it has, and retrying clears it.
 */
export function canRetry(graph: ConversationGraph, nodeId: string): boolean {
  const node = graph.nodesById[nodeId];
  return !!node && node.status === "error" && childIds(graph, nodeId).length === 0;
}

/** Continue asks for the rest of a stopped reply, in a new card below it. */
export function canContinue(node: ConversationNode): boolean {
  return node.status === "interrupted" && canBranchFrom(node);
}

/** Regenerate asks the same prompt again in a new sibling card. Not while this one is still going. */
export function canRegenerate(graph: ConversationGraph, nodeId: string): boolean {
  const node = graph.nodesById[nodeId];
  if (!node || node.status === "streaming") return false;
  const parent = node.parentId ? graph.nodesById[node.parentId] : null;
  return node.parentId === null || (!!parent && canBranchFrom(parent));
}

export type AddNodeInput = {
  parentId?: string | null;
  prompt: string;
  position: Point;
  model?: string | null;
  /** Injectable so tests are deterministic. */
  id?: string;
  now?: number;
};

export function addNode(
  graph: ConversationGraph,
  input: AddNodeInput,
): { graph: ConversationGraph; node: ConversationNode } {
  const parentId = input.parentId ?? null;

  if (parentId !== null) {
    const parent = requireNode(graph, parentId);
    if (!canBranchFrom(parent)) {
      throw new Error(
        `Cannot branch from ${parentId}: it has no answer yet.`,
      );
    }
  }

  const now = input.now ?? Date.now();
  const node: ConversationNode = {
    id: input.id ?? newNodeId(),
    parentId,
    prompt: input.prompt,
    response: "",
    thinking: "",
    status: "draft",
    error: null,
    position: input.position,
    positionMode: "auto",
    size: null,
    collapsed: false,
    bodyCollapsed: false,
    usage: null,
    model: input.model ?? null,
    createdAt: now,
    updatedAt: now,
  };

  return {
    graph: {
      nodesById: { ...graph.nodesById, [node.id]: node },
      nodeIds: [...graph.nodeIds, node.id],
    },
    node,
  };
}

/** Removes a node and every descendant — an abandoned branch goes as a unit. */
export function removeBranch(
  graph: ConversationGraph,
  nodeId: string,
): ConversationGraph {
  const doomed = new Set(descendantIds(graph, nodeId));
  const nodesById: Record<string, ConversationNode> = {};

  for (const id of graph.nodeIds) {
    if (!doomed.has(id)) nodesById[id] = graph.nodesById[id];
  }

  return {
    nodesById,
    nodeIds: graph.nodeIds.filter((id) => !doomed.has(id)),
  };
}

function patchNode(
  graph: ConversationGraph,
  nodeId: string,
  patch: Partial<ConversationNode>,
  now?: number,
): ConversationGraph {
  const node = requireNode(graph, nodeId);
  const next: ConversationNode = {
    ...node,
    ...patch,
    updatedAt: now ?? Date.now(),
  };

  return {
    nodesById: { ...graph.nodesById, [nodeId]: next },
    nodeIds: graph.nodeIds,
  };
}

/** A drag: sets the position and pins the node to `manual` so Tidy leaves it alone. */
export function moveNode(
  graph: ConversationGraph,
  nodeId: string,
  position: Point,
  now?: number,
): ConversationGraph {
  return patchNode(graph, nodeId, { position, positionMode: "manual" }, now);
}

/** Auto-placement writing a computed position without disturbing `positionMode`. */
export function placeNode(
  graph: ConversationGraph,
  nodeId: string,
  position: Point,
  now?: number,
): ConversationGraph {
  return patchNode(graph, nodeId, { position }, now);
}

export function setCollapsed(
  graph: ConversationGraph,
  nodeId: string,
  collapsed: boolean,
  now?: number,
): ConversationGraph {
  return patchNode(graph, nodeId, { collapsed }, now);
}

export function setBodyCollapsed(
  graph: ConversationGraph,
  nodeId: string,
  bodyCollapsed: boolean,
  now?: number,
): ConversationGraph {
  return patchNode(graph, nodeId, { bodyCollapsed }, now);
}

/** A drag on the resize handle: sets a persisted, explicit size for the card. */
export function resizeNode(
  graph: ConversationGraph,
  nodeId: string,
  size: Size,
  now?: number,
): ConversationGraph {
  return patchNode(graph, nodeId, { size }, now);
}

/** §2.4 Tidy: every node reverts to `auto` so the next layout pass places it. */
export function resetAllToAuto(graph: ConversationGraph, now?: number): ConversationGraph {
  let next = graph;
  for (const id of graph.nodeIds) {
    if (graph.nodesById[id].positionMode === "auto") continue;
    next = patchNode(next, id, { positionMode: "auto" }, now);
  }
  return next;
}

/** Pins a node to another model, for the next time it is sent: a retry reuses the node's model, not the picker's. */
export function setNodeModel(
  graph: ConversationGraph,
  nodeId: string,
  model: string,
  now?: number,
): ConversationGraph {
  return patchNode(graph, nodeId, { model }, now);
}

export function setPrompt(
  graph: ConversationGraph,
  nodeId: string,
  prompt: string,
  now?: number,
): ConversationGraph {
  return patchNode(graph, nodeId, { prompt }, now);
}

/**
 * Marks a node as awaiting a response. Clears any previous answer so that
 * retrying a failed node does not append to the text that failed.
 */
export function startStreaming(
  graph: ConversationGraph,
  nodeId: string,
  now?: number,
): ConversationGraph {
  return patchNode(
    graph,
    nodeId,
    { status: "streaming", response: "", thinking: "", error: null, usage: null },
    now,
  );
}

/**
 * `current + text`, cut at `MAX_BRANCH_CHARS` — the most the server will save
 * for a response or a reasoning summary. Past the cap the rest of the stream is
 * dropped rather than kept on screen and refused by every save. Null when
 * nothing fits. Never ends on half a surrogate pair.
 */
function capped(current: string, text: string): string | null {
  let room = MAX_BRANCH_CHARS - current.length;
  if (room <= 0) return null;
  if (text.length <= room) return current + text;
  const code = text.charCodeAt(room - 1);
  if (code >= 0xd800 && code <= 0xdbff) room -= 1;
  return room > 0 ? current + text.slice(0, room) : null;
}

export function appendText(
  graph: ConversationGraph,
  nodeId: string,
  text: string,
  now?: number,
): ConversationGraph {
  const node = requireNode(graph, nodeId);
  const response = capped(node.response, text);
  return response === null ? graph : patchNode(graph, nodeId, { response }, now);
}

export function appendThinking(
  graph: ConversationGraph,
  nodeId: string,
  text: string,
  now?: number,
): ConversationGraph {
  const node = requireNode(graph, nodeId);
  const thinking = capped(node.thinking, text);
  return thinking === null ? graph : patchNode(graph, nodeId, { thinking }, now);
}

export function completeNode(
  graph: ConversationGraph,
  nodeId: string,
  usage: { inputTokens: number; outputTokens: number } | null,
  now?: number,
): ConversationGraph {
  return patchNode(graph, nodeId, { status: "complete", usage }, now);
}

export function failNode(
  graph: ConversationGraph,
  nodeId: string,
  error: NodeError,
  now?: number,
): ConversationGraph {
  return patchNode(graph, nodeId, { status: "error", error }, now);
}

/**
 * Stopped deliberately, or the connection dropped. Keeps whatever text
 * arrived: a half-written answer is still worth reading, and discarding it
 * would make cancelling feel like losing work.
 */
export function interruptNode(
  graph: ConversationGraph,
  nodeId: string,
  now?: number,
): ConversationGraph {
  return patchNode(graph, nodeId, { status: "interrupted" }, now);
}

/**
 * Any node left mid-stream when the tab went away. A `streaming` status can
 * never be resumed across a reload — the request is gone — so a rehydrated
 * graph must reconcile them or the canvas shows spinners that never stop.
 */
export function settleOrphanedStreams(
  graph: ConversationGraph,
  now?: number,
): ConversationGraph {
  let next = graph;

  for (const id of graph.nodeIds) {
    if (graph.nodesById[id].status !== "streaming") continue;
    next = patchNode(next, id, { status: "interrupted" }, now);
  }

  return next;
}

export type BranchTooLong = {
  reason: "messages" | "chars" | "message_chars";
  /** Written for a person, matching the server's phrasing for the same cap. */
  message: string;
};

/**
 * The request body for answering `nodeId`: every ancestor exchange in order,
 * then this node's prompt.
 *
 * The node's own `response` is deliberately excluded — it is what we are
 * asking for. Re-running a node that already has an answer therefore replaces
 * it rather than continuing it.
 */
export function toMessages(
  graph: ConversationGraph,
  nodeId: string,
): ChatMessage[] {
  const path = pathToRoot(graph, nodeId);
  const messages: ChatMessage[] = [];

  for (const node of path) {
    messages.push({ role: "user", content: node.prompt });
    // Every node on the path except the target has an answer, because
    // `addNode` refuses to hang a child off an unanswered node.
    if (node.id !== nodeId) {
      messages.push({ role: "assistant", content: node.response });
    }
  }

  return messages;
}

/**
 * Checks a branch against the server's caps so the canvas can say "this
 * branch is too long, start a new node further up" before spending a request.
 * Returns `null` when the branch is sendable.
 */
export function checkBranchSize(messages: ChatMessage[]): BranchTooLong | null {
  if (messages.length > MAX_BRANCH_MESSAGES) {
    return {
      reason: "messages",
      message: `This branch is too long — it holds more than ${MAX_BRANCH_MESSAGES} messages. Start a new node from further up.`,
    };
  }

  let total = 0;
  for (const message of messages) {
    if (message.content.length > MAX_MESSAGE_CHARS) {
      return { reason: "message_chars", message: "One message is too long to send." };
    }
    total += message.content.length;
  }

  if (total > MAX_BRANCH_CHARS) {
    return {
      reason: "chars",
      message:
        "This branch is too long to send. Start a new node from further up.",
    };
  }

  return null;
}

export function newNodeId(): string {
  // The nodes table keys on uuid. crypto.randomUUID exists in every secure
  // context (https, localhost) and in Node, which is everywhere this runs.
  return crypto.randomUUID();
}
