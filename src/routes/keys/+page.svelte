<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Alert from '$lib/components/Alert.svelte';
	import Button from '$lib/components/Button.svelte';
	import Shell from '$lib/components/Shell.svelte';
	import TextField from '$lib/components/TextField.svelte';
	import { KEYS_COPY } from '$lib/copy/auth';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let verifying = $state(false);

	const failure = $derived(form && 'message' in form ? form : null);
	const fields = $derived(form && 'fields' in form ? form.fields : undefined);
</script>

<svelte:head><title>Your key · node-canvas</title></svelte:head>

<Shell>
	<p class="account">Signed in as <strong>{data.email}</strong></p>
	<h1>{KEYS_COPY.title}</h1>
	<ul class="trust">
		{#each KEYS_COPY.trust as line (line)}<li>{line}</li>{/each}
	</ul>

	{#if form?.action === 'connect' && 'saved' in form}
		<Alert tone="ok" title={KEYS_COPY.saved} />
	{/if}
	{#if failure?.action === 'connect' && failure.message}
		<Alert tone="danger">{failure.message}</Alert>
	{/if}

	<p class="status">{data.key ? KEYS_COPY.connected(data.key.last4) : KEYS_COPY.notConnected}</p>

	<form
		method="POST"
		action="?/connect"
		use:enhance={() => {
			verifying = true;
			return async ({ update }) => {
				await update();
				verifying = false;
			};
		}}
	>
		<TextField
			label={KEYS_COPY.keyLabel}
			name="apiKey"
			type="password"
			autocomplete="off"
			hint={KEYS_COPY.keyHint}
			error={fields?.apiKey}
			required
		/>
		<Button disabled={verifying}>
			{verifying ? KEYS_COPY.verifying : data.key ? KEYS_COPY.replace : KEYS_COPY.connect}
		</Button>
	</form>

	<div class="row">
		{#if data.key}
			<form method="POST" action="?/remove" use:enhance>
				<Button variant="secondary">{KEYS_COPY.remove}</Button>
			</form>
			<a href={resolve('/canvas')}>{KEYS_COPY.openCanvas}</a>
		{/if}
		<form method="POST" action="?/signOut" use:enhance>
			<Button variant="secondary">{KEYS_COPY.signOut}</Button>
		</form>
	</div>

	<section class="danger" aria-labelledby="danger-heading">
		<h2 id="danger-heading">{KEYS_COPY.deleteHeading}</h2>
		<p>{KEYS_COPY.deleteBody}</p>
		<p class="provider">{KEYS_COPY.deleteProvider}</p>
		{#if failure?.action === 'deleteAccount' && failure.message}
			<Alert tone="danger">{failure.message}</Alert>
		{/if}
		<form method="POST" action="?/deleteAccount" use:enhance>
			<label class="confirm"><input type="checkbox" name="confirm" value="yes" /> {KEYS_COPY.deleteConfirm}</label>
			<Button variant="destructive">{KEYS_COPY.deleteButton}</Button>
		</form>
	</section>
</Shell>

<style>
	.account,
	.status {
		color: var(--muted);
		font-size: var(--text-sm);
	}
	h1 {
		font-size: var(--text-2xl);
		margin: var(--space-2) 0 var(--space-4);
	}
	.trust {
		padding-left: var(--space-6);
		margin: 0 0 var(--space-6);
		font-size: var(--text-sm);
	}
	.row {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		margin: var(--space-6) 0;
	}
	.danger {
		margin-top: var(--space-8);
		padding: var(--space-4);
		border: 1px solid var(--danger-border);
		border-radius: var(--radius-md);
	}
	.danger h2 {
		margin: 0 0 var(--space-2);
		font-size: var(--text-base);
		color: var(--danger);
	}
	.danger p {
		margin: 0 0 var(--space-2);
		font-size: var(--text-sm);
	}
	.provider {
		font-weight: 500;
	}
	.confirm {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		margin: var(--space-3) 0;
		font-size: var(--text-sm);
	}
</style>
