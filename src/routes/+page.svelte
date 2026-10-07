<script lang="ts">
	import { resolve } from '$app/paths';
	import ConversationGraph from '$lib/components/ConversationGraph.svelte';
	import Shell from '$lib/components/Shell.svelte';
	import { ANTHROPIC_KEYS_URL, LANDING_COPY as c, SOURCE_URL } from '$lib/copy/landing';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>{c.title}</title></svelte:head>

{#if data.user}
	<!-- Someone returning has already read the pitch: the product's own frame, and the way back in. -->
	<Shell>
		<h1>{c.welcomeTitle}</h1>
		<p class="lede">{c.welcomeBody}</p>
		<div class="actions">
			<a class="button primary" href={resolve('/canvas')}>{c.openCanvas}</a>
			<a class="button secondary" href={resolve('/keys')}>{c.manageKey}</a>
		</div>
	</Shell>
{:else}
	<!-- A stranger: say what this is, show it, then offer the way in. -->
	<main class="hero">
		<p class="eyebrow">{c.eyebrow}</p>
		<h1>{c.headline}</h1>
		<p class="lede">{c.lede}</p>
		<div class="drawing"><ConversationGraph /></div>
		<div class="actions">
			<a class="button primary" href={resolve('/sign-up')}>{c.primary}</a>
			<a class="button secondary" href={resolve('/sign-in')}>{c.secondary}</a>
		</div>
		<p class="note">
			{c.keyNoteBefore}<a href={ANTHROPIC_KEYS_URL} target="_blank" rel="external noopener noreferrer">{c.keyNoteLink}</a
			>{c.keyNoteAfter}
		</p>
		<h2>{c.stepsHeading}</h2>
		<ol class="steps">
			{#each c.steps as step, i (step.title)}
				<li>
					<span class="number" aria-hidden="true">{i + 1}</span>
					<div>
						<p class="step-title">{step.title}</p>
						<p class="step-body">{step.body}</p>
					</div>
				</li>
			{/each}
		</ol>
		<p class="note">
			{c.openSource}
			<a href={SOURCE_URL} target="_blank" rel="external noopener noreferrer">{c.source}</a>
		</p>
	</main>
{/if}

<style>
	.hero {
		max-width: 36rem;
		margin: 0 auto;
		padding: var(--space-12) var(--space-6);
	}
	.eyebrow,
	h2 {
		margin: 0;
		font: 500 var(--text-xs) / 1 var(--font-mono);
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--muted);
	}
	h1 {
		margin: var(--space-4) 0 0;
		font-size: var(--text-3xl);
		line-height: 1.15;
		letter-spacing: -0.01em;
		text-wrap: balance;
	}
	.lede {
		margin: var(--space-4) 0 0;
		font-size: var(--text-lg);
		line-height: 1.6;
		text-wrap: pretty;
	}
	.drawing {
		max-width: 28rem;
		margin: var(--space-8) auto 0;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		margin-top: var(--space-8);
	}
	.button {
		display: inline-flex;
		align-items: center;
		min-height: 40px;
		padding: 0 var(--space-4);
		border-radius: var(--radius-sm);
		border: 1px solid transparent;
		font-weight: 500;
		text-decoration: none;
	}
	.primary {
		background: var(--foreground);
		color: var(--background);
	}
	.secondary {
		background: var(--background);
		color: var(--foreground);
		border-color: var(--hairline);
	}
	.note {
		margin: var(--space-4) 0 0;
		font-size: var(--text-sm);
		line-height: 1.6;
		color: var(--muted);
	}
	h2 {
		margin-top: var(--space-12);
	}
	.steps {
		list-style: none;
		margin: var(--space-4) 0 0;
		padding: 0;
		border-block: 1px solid var(--hairline);
	}
	.steps li {
		display: flex;
		gap: var(--space-4);
		padding: var(--space-4) 0;
	}
	.steps li + li {
		border-top: 1px solid var(--hairline);
	}
	.number {
		font: var(--text-xs) / 1.5rem var(--font-mono);
		color: var(--muted);
	}
	.step-title {
		margin: 0;
		font-size: var(--text-sm);
		font-weight: 500;
		line-height: 1.5rem;
	}
	.step-body {
		margin: var(--space-1) 0 0;
		font-size: var(--text-sm);
		line-height: 1.6;
		color: var(--muted);
	}
</style>
