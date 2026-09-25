<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		children,
		type = 'submit',
		variant = 'primary',
		disabled = false,
		full = false,
		formaction
	}: {
		children: Snippet;
		type?: 'submit' | 'button';
		variant?: 'primary' | 'secondary' | 'destructive';
		disabled?: boolean;
		full?: boolean;
		formaction?: string;
	} = $props();
</script>

<button {type} {disabled} {formaction} class={variant} class:full>{@render children()}</button>

<style>
	button {
		font: inherit;
		font-weight: 500;
		min-height: 40px;
		padding: 0 var(--space-4);
		border-radius: var(--radius-sm);
		border: 1px solid transparent;
		cursor: pointer;
		transition: opacity var(--dur-base) var(--ease-out);
	}
	button:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.full {
		width: 100%;
	}
	.primary {
		background: var(--foreground);
		color: var(--background);
	}
	.secondary {
		background: var(--background);
		border-color: var(--hairline);
	}
	.destructive {
		background: var(--danger);
		color: #fff;
	}
</style>
