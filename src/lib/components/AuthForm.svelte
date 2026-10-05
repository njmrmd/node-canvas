<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { AUTH_COPY, type AuthMode } from '$lib/copy/auth';
	import Alert from './Alert.svelte';
	import Button from './Button.svelte';
	import TextField from './TextField.svelte';

	type Failure = { email?: string; fields?: Record<string, string>; message?: string } | null;
	let { mode, next, form }: { mode: AuthMode; next: string | null; form: Failure } = $props();

	const copy = $derived(AUTH_COPY[mode]);
	// footerHref is always '/sign-in' or '/sign-up', optionally with a `next` query — both are
	// known routes, but the template literal loses that narrow type through $derived, so it is
	// asserted back to the type resolve() expects. The runtime value is unchanged. (Not the
	// generated RouteIdWithSearchOrHash: once a dynamic route exists that union includes routes
	// resolve() wants params for.)
	type AuthPath = '/sign-in' | '/sign-up' | `/sign-in?${string}` | `/sign-up?${string}`;
	const footerHref = $derived(
		(next ? `${copy.footerHref}?next=${encodeURIComponent(next)}` : copy.footerHref) as AuthPath
	);
	let busy = $state(false);
</script>

<h1>{copy.title}</h1>
<p class="sub">{copy.subheading}</p>

{#if form?.message}<Alert tone="danger">{form.message}</Alert>{/if}

<form
	method="POST"
	novalidate
	use:enhance={() => {
		busy = true;
		return async ({ update }) => {
			await update({ reset: false });
			busy = false;
		};
	}}
>
	<TextField label="Email" name="email" type="email" autocomplete="email" value={form?.email ?? ''} error={form?.fields?.email} required />
	<TextField
		label="Password"
		name="password"
		type="password"
		autocomplete={copy.autocomplete}
		hint={copy.passwordHint}
		note={copy.passwordNote}
		error={form?.fields?.password}
		required
	/>
	<Button full disabled={busy}>{busy ? copy.busy : copy.submit}</Button>
</form>

<p class="footer">{copy.footer} <a href={resolve(footerHref)}>{copy.footerLink}</a></p>
{#if mode === 'sign-in'}<p class="recovery">{AUTH_COPY['sign-in'].recovery}</p>{/if}

<style>
	h1 {
		font-size: var(--text-2xl);
		margin: 0 0 var(--space-2);
	}
	.sub {
		color: var(--muted);
		margin: 0 0 var(--space-6);
	}
	.footer,
	.recovery {
		font-size: var(--text-sm);
		color: var(--muted);
		margin-top: var(--space-4);
	}
</style>
