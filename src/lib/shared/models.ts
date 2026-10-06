/**
 * The server-side model allowlist, also sent to the canvas for its selector.
 * Exact model ids — never date-suffixed. Refreshed when Anthropic ships models.
 */
export type ModelSpec = {
	id: string;
	label: string;
	description: string;
	/** 'adaptive' sends thinking { type: 'adaptive', display: 'summarized' }; 'none' omits it. */
	thinking: 'adaptive' | 'none';
	/** output_config.effort, or null to omit (Haiku 4.5 rejects effort). */
	effort: 'medium' | null;
	/** Server-side refusal fallbacks (fallbacks: "default"). */
	fallbacks: boolean;
};

export const MODELS: readonly ModelSpec[] = [
	{
		id: 'claude-opus-5-5',
		label: 'Claude Opus 5.5',
		description: 'Most capable. The default.',
		thinking: 'adaptive',
		effort: 'medium',
		fallbacks: true
	},
	{
		id: 'claude-sonnet-5-5',
		label: 'Claude Sonnet 5.5',
		description: 'Faster and cheaper, still strong.',
		thinking: 'adaptive',
		effort: 'medium',
		fallbacks: true
	},
	{
		id: 'claude-haiku-4-5',
		label: 'Claude Haiku 4.5',
		description: 'Fastest. Good for short branches.',
		thinking: 'none',
		effort: null,
		fallbacks: false
	}
];

export const DEFAULT_MODEL_ID = 'claude-opus-5-5';

export function findModel(id: unknown): ModelSpec | null {
	return typeof id === 'string' ? (MODELS.find((m) => m.id === id) ?? null) : null;
}
