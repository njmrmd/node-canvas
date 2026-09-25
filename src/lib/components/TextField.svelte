<script lang="ts">
	let {
		label,
		name,
		type = 'text',
		value = '',
		autocomplete,
		hint,
		note,
		error,
		required = false
	}: {
		label: string;
		name: string;
		type?: string;
		value?: string;
		autocomplete?: HTMLInputElement['autocomplete'];
		hint?: string;
		note?: string;
		error?: string;
		required?: boolean;
	} = $props();

	const id = `field-${name}`;
	const describedBy = $derived(
		[error && `${id}-error`, hint && `${id}-hint`, note && `${id}-note`].filter(Boolean).join(' ') || undefined
	);
</script>

<div class="field">
	<label for={id}>{label}</label>
	<input
		{id}
		{name}
		{type}
		{value}
		{autocomplete}
		{required}
		aria-invalid={error ? 'true' : undefined}
		aria-describedby={describedBy}
	/>
	{#if error}<p class="error" id="{id}-error">{error}</p>{/if}
	{#if hint}<p class="hint" id="{id}-hint">{hint}</p>{/if}
	{#if note}<p class="note" id="{id}-note">{note}</p>{/if}
</div>

<style>
	.field {
		display: grid;
		gap: var(--space-1);
		margin-bottom: var(--space-4);
	}
	label {
		font-size: var(--text-sm);
		font-weight: 500;
	}
	input {
		font: inherit;
		padding: var(--space-2) var(--space-3);
		min-height: 40px;
		border: 1px solid var(--border-input);
		border-radius: var(--radius-sm);
		background: var(--background);
	}
	input[aria-invalid='true'] {
		border-color: var(--danger-border);
	}
	p {
		margin: 0;
		font-size: var(--text-sm);
	}
	.error {
		color: var(--danger);
	}
	.hint {
		color: var(--muted);
	}
	.note {
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--surface-subtle);
	}
</style>
