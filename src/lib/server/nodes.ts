import type { NodeWire, ViewWire } from '../canvas/node-wire';
import { MAX_MESSAGE_CHARS, MAX_TOTAL_CHARS } from '../shared/chat-limits';
import { ERROR_CODES } from '../shared/error-codes';
import { ApiError } from './api-error';
import { query, queryOne, withTransaction } from './db';

export const MAX_SAVE_BYTES = 4 * 1024 * 1024;
export const MAX_SAVE_NODES = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ['draft', 'streaming', 'complete', 'interrupted', 'error'] as const;
const NODE_ERROR_CODES: readonly string[] = [...ERROR_CODES, 'network', 'timeout'];
const COORD = 1e7;

export function isUuid(value: unknown): value is string {
	return typeof value === 'string' && UUID.test(value);
}

/** A page of the canvas load stays well under Vercel's 4.5 MB response cap, even with JSON escaping. */
export const PAGE_BYTES = 3 * 1024 * 1024;
/** How many rows one page looks at when choosing what fits. */
const PAGE_SCAN = 500;
/** One node's JSON besides its three texts — ids, numbers, field names — rounded up. */
const NODE_OVERHEAD_BYTES = 512;

/** Where the next page starts: the last node sent, in the load's (created_at, id) order. */
export type Cursor = { createdAt: string; id: string };
const CURSOR_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export function encodeCursor(cursor: Cursor): string {
	return `${cursor.createdAt}_${cursor.id}`;
}

export function decodeCursor(value: string): Cursor | null {
	const cut = value.indexOf('_');
	if (cut === -1) return null;
	const createdAt = value.slice(0, cut);
	const id = value.slice(cut + 1);
	return CURSOR_TIME.test(createdAt) && isUuid(id) ? { createdAt, id } : null;
}

/** The rows that go in one page: as many as fit in `budget` bytes, and always at least one. */
export function takePage<T extends { bytes: number }>(rows: readonly T[], budget: number): T[] {
	const page: T[] = [];
	let total = 0;
	for (const row of rows) {
		const size = row.bytes + NODE_OVERHEAD_BYTES;
		if (page.length > 0 && total + size > budget) break;
		page.push(row);
		total += size;
	}
	return page;
}

function bad(message: string): never {
	throw new ApiError('invalid_request', message);
}

const num = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const text = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;

/**
 * Postgres text and jsonb refuse U+0000 and unpaired surrogates, and the jsonb cast fails the whole
 * batch on one bad character. Both become U+FFFD, the same length, so the caps above still hold.
 */
export const sanitize = (s: string) => s.replaceAll('\u0000', '\uFFFD').toWellFormed();

function parseNode(raw: unknown, i: number): NodeWire {
	if (typeof raw !== 'object' || raw === null) bad(`Node ${i} is malformed.`);
	const n = raw as Record<string, unknown>;
	if (!isUuid(n.id)) bad(`Node ${i} has a malformed id.`);
	if (n.parentId !== null && !isUuid(n.parentId)) bad(`Node ${i} has a malformed parent.`);
	if (!text(n.prompt, MAX_MESSAGE_CHARS)) bad(`Node ${i}'s prompt is too long.`);
	if (!text(n.response, MAX_TOTAL_CHARS)) bad(`Node ${i}'s response is too long.`);
	if (!text(n.thinking, MAX_TOTAL_CHARS)) bad(`Node ${i}'s thinking is too long.`);
	if (!STATUSES.includes(n.status as (typeof STATUSES)[number])) bad(`Node ${i} has an unknown status.`);
	if (n.error !== null) {
		const e = n.error as Record<string, unknown> | undefined;
		if (!e || !NODE_ERROR_CODES.includes(e.code as string) || !text(e.message, 2000)) bad(`Node ${i} has a malformed error.`);
	}
	if (n.usage !== null) {
		const u = n.usage as Record<string, unknown> | undefined;
		if (!u || !num(u.inputTokens, 0, 1e9) || !num(u.outputTokens, 0, 1e9)) bad(`Node ${i} has malformed usage.`);
	}
	if (n.model !== null && !text(n.model, 100)) bad(`Node ${i} has a malformed model.`);
	if (!num(n.x, -COORD, COORD) || !num(n.y, -COORD, COORD)) bad(`Node ${i} has a malformed position.`);
	if (n.positionMode !== 'auto' && n.positionMode !== 'manual') bad(`Node ${i} has a malformed position mode.`);
	for (const k of ['width', 'height'] as const) if (n[k] !== null && !num(n[k], 1, 10_000)) bad(`Node ${i} has a malformed size.`);
	if (typeof n.collapsed !== 'boolean' || typeof n.bodyCollapsed !== 'boolean') bad(`Node ${i} has malformed flags.`);
	if (!num(n.createdAt, 0, 8.64e15) || !num(n.updatedAt, 0, 8.64e15)) bad(`Node ${i} has malformed timestamps.`);
	const error = n.error as NodeWire['error'];
	return {
		id: n.id as string,
		parentId: n.parentId as string | null,
		prompt: sanitize(n.prompt as string),
		response: sanitize(n.response as string),
		thinking: sanitize(n.thinking as string),
		status: n.status as NodeWire['status'],
		error: error && { code: error.code, message: sanitize(error.message) },
		usage: n.usage as NodeWire['usage'],
		model: n.model === null ? null : sanitize(n.model as string),
		x: n.x as number,
		y: n.y as number,
		positionMode: n.positionMode as NodeWire['positionMode'],
		width: n.width as number | null,
		height: n.height as number | null,
		collapsed: n.collapsed as boolean,
		bodyCollapsed: n.bodyCollapsed as boolean,
		createdAt: n.createdAt as number,
		updatedAt: n.updatedAt as number
	};
}

function parseView(raw: unknown): ViewWire | null {
	if (raw === undefined || raw === null) return null;
	const v = raw as Record<string, unknown>;
	const vp = v.viewport as Record<string, unknown> | undefined;
	if (!vp || !num(vp.x, -1e9, 1e9) || !num(vp.y, -1e9, 1e9) || !num(vp.zoom, 0.01, 10)) bad('The view is malformed.');
	if (v.targetNodeId !== null && !isUuid(v.targetNodeId)) bad('The view target is malformed.');
	return { viewport: { x: vp.x as number, y: vp.y as number, zoom: vp.zoom as number }, targetNodeId: v.targetNodeId as string | null };
}

export function parseSaveBody(body: Record<string, unknown>): { upserts: NodeWire[]; view: ViewWire | null } {
	if (!Array.isArray(body.upserts)) bad('Expected a list of nodes.');
	if (body.upserts.length > MAX_SAVE_NODES) bad(`Save at most ${MAX_SAVE_NODES} nodes at a time.`);
	return { upserts: body.upserts.map(parseNode), view: parseView(body.view) };
}

type NodeRow = {
	id: string;
	parent_id: string | null;
	prompt: string;
	response: string;
	thinking: string;
	status: NodeWire['status'];
	error: NodeWire['error'];
	usage: NodeWire['usage'];
	model: string | null;
	x: number;
	y: number;
	position_mode: NodeWire['positionMode'];
	width: number | null;
	height: number | null;
	collapsed: boolean;
	body_collapsed: boolean;
	created_ms: string;
	updated_ms: string;
};

/** One transaction: upsert every node the user owns, then the view. */
export async function saveNodes(userId: string, upserts: NodeWire[], view: ViewWire | null): Promise<{ rejected: string[] }> {
	const rows = upserts.map((n) => ({
		id: n.id,
		parent_id: n.parentId,
		prompt: n.prompt,
		response: n.response,
		thinking: n.thinking,
		status: n.status,
		error: n.error,
		usage: n.usage,
		model: n.model,
		x: n.x,
		y: n.y,
		position_mode: n.positionMode,
		width: n.width,
		height: n.height,
		collapsed: n.collapsed,
		body_collapsed: n.bodyCollapsed,
		created_at: n.createdAt,
		updated_at: n.updatedAt
	}));
	try {
		return await withTransaction(async (run) => {
			const saved = rows.length
				? await run<{ id: string }>(
						`insert into nodes (id, user_id, parent_id, prompt, response, thinking, status, error, usage, model,
						                    x, y, position_mode, width, height, collapsed, body_collapsed, created_at, updated_at)
						 select r.id, $1, r.parent_id, r.prompt, r.response, r.thinking, r.status, r.error, r.usage, r.model,
						        r.x, r.y, r.position_mode, r.width, r.height, r.collapsed, r.body_collapsed,
						        to_timestamp(r.created_at / 1000.0), to_timestamp(r.updated_at / 1000.0)
						   from jsonb_to_recordset($2::jsonb) as r(
						        id uuid, parent_id uuid, prompt text, response text, thinking text, status text, error jsonb,
						        usage jsonb, model text, x double precision, y double precision, position_mode text,
						        width double precision, height double precision, collapsed boolean, body_collapsed boolean,
						        created_at double precision, updated_at double precision)
						 on conflict (id) do update set
						        parent_id = excluded.parent_id, prompt = excluded.prompt, response = excluded.response,
						        thinking = excluded.thinking, status = excluded.status, error = excluded.error,
						        usage = excluded.usage, model = excluded.model, x = excluded.x, y = excluded.y,
						        position_mode = excluded.position_mode, width = excluded.width, height = excluded.height,
						        collapsed = excluded.collapsed, body_collapsed = excluded.body_collapsed,
						        updated_at = excluded.updated_at
						  where nodes.user_id = excluded.user_id
						 returning id`,
						[userId, JSON.stringify(rows)]
					)
				: [];
			if (view) {
				// The subquery drops a target that is unsaved or someone else's.
				await run(
					`insert into canvas_view (user_id, viewport, target_node_id, updated_at)
					 values ($1, $2::jsonb, (select id from nodes where id = $3 and user_id = $1), now())
					 on conflict (user_id) do update
					    set viewport = excluded.viewport, target_node_id = excluded.target_node_id, updated_at = now()`,
					[userId, JSON.stringify(view.viewport), view.targetNodeId]
				);
			}
			const accepted = new Set(saved.map((r) => r.id));
			return { rejected: upserts.map((n) => n.id).filter((id) => !accepted.has(id)) };
		});
	} catch (error) {
		// The parent FK is checked at the end of the single insert…select statement, not per row, so a
		// child may come before its parent in one batch. A parent that is in neither the batch nor the
		// table fails the statement, and the transaction rolls back with nothing written.
		if ((error as { code?: string }).code === '23503') {
			throw new ApiError('invalid_request', 'A node referenced a parent that is not on this canvas.');
		}
		throw error;
	}
}

export async function deleteNode(userId: string, id: string): Promise<void> {
	await query('delete from nodes where id = $1 and user_id = $2', [id, userId]);
}

const NODE_COLUMNS = `id, parent_id, prompt, response, thinking, status, error, usage, model, x, y, position_mode, width, height,
	collapsed, body_collapsed,
	(extract(epoch from created_at) * 1000)::bigint::text as created_ms,
	(extract(epoch from updated_at) * 1000)::bigint::text as updated_ms`;

function fromRow(r: NodeRow): NodeWire {
	return {
		id: r.id,
		parentId: r.parent_id,
		prompt: r.prompt,
		response: r.response,
		thinking: r.thinking,
		status: r.status,
		error: r.error,
		usage: r.usage,
		model: r.model,
		x: r.x,
		y: r.y,
		positionMode: r.position_mode,
		width: r.width,
		height: r.height,
		collapsed: r.collapsed,
		bodyCollapsed: r.body_collapsed,
		createdAt: Number(r.created_ms),
		updatedAt: Number(r.updated_ms)
	};
}

/**
 * One page of the canvas load, in creation order. Which nodes fit is decided from the texts' byte
 * lengths before any text is read, so a page carries at most `budget` bytes of text — or one node
 * bigger than that, alone.
 */
export async function loadNodesPage(
	userId: string,
	after: Cursor | null,
	budget = PAGE_BYTES
): Promise<{ nodes: NodeWire[]; next: Cursor | null }> {
	const scanned = await query<{ id: string; created_iso: string; bytes: number }>(
		`select id,
		        to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_iso,
		        (octet_length(prompt) + octet_length(response) + octet_length(thinking))::int as bytes
		   from nodes
		  where user_id = $1 and ($2::timestamptz is null or (created_at, id) > ($2::timestamptz, $3::uuid))
		  order by created_at, id
		  limit ${PAGE_SCAN}`,
		[userId, after?.createdAt ?? null, after?.id ?? null]
	);
	const page = takePage(scanned, budget);
	if (page.length === 0) return { nodes: [], next: null };
	const rows = await query<NodeRow>(
		`select ${NODE_COLUMNS} from nodes where user_id = $1 and id = any($2::uuid[]) order by created_at, id`,
		[userId, page.map((r) => r.id)]
	);
	const last = page[page.length - 1];
	const more = page.length < scanned.length || scanned.length === PAGE_SCAN;
	return { nodes: rows.map(fromRow), next: more ? { createdAt: last.created_iso, id: last.id } : null };
}

export async function loadView(userId: string): Promise<ViewWire | null> {
	const view = await queryOne<{ viewport: ViewWire['viewport']; target_node_id: string | null }>(
		'select viewport, target_node_id from canvas_view where user_id = $1',
		[userId]
	);
	return view ? { viewport: view.viewport, targetNodeId: view.target_node_id } : null;
}

/** Every node and the view, page by page — for the database tests and anything else server-side. */
export async function loadCanvas(userId: string): Promise<{ nodes: NodeWire[]; view: ViewWire | null }> {
	const nodes: NodeWire[] = [];
	let after: Cursor | null = null;
	do {
		const page: { nodes: NodeWire[]; next: Cursor | null } = await loadNodesPage(userId, after);
		nodes.push(...page.nodes);
		after = page.next;
	} while (after !== null);
	return { nodes, view: await loadView(userId) };
}
