<!-- Spec §2: desktop only. Shown instead of the page below 900 px (the layout hides the page). -->
<script lang="ts">
	import { copy } from '$lib/canvas/copy';
</script>

<div class="desktop-only" role="note">
	<h1>{copy('desktop.title')}</h1>
	<p>{copy('desktop.body')}</p>
</div>

<style>
	.desktop-only {
		display: none;
	}
	@media (max-width: 899px) {
		.desktop-only {
			display: flex;
			flex-direction: column;
			justify-content: center;
			gap: var(--space-3);
			min-height: 100vh;
			padding: var(--space-6);
			font-family: var(--font-sans);
			background: var(--background);
			color: var(--foreground);
		}
	}
	h1 {
		margin: 0;
		font-size: var(--text-2xl);
	}
	p {
		margin: 0;
		font-size: var(--text-base);
		color: var(--muted);
	}
</style>
