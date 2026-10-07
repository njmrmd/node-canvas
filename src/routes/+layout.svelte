<script lang="ts">
	import { page } from '$app/state';
	import favicon from '$lib/assets/favicon.svg';
	import DesktopOnlyNotice from '$lib/components/DesktopOnlyNotice.svelte';
	import '$lib/styles/tokens.css';
	import '$lib/styles/base.css';

	let { children } = $props();
	// The landing page stays readable on a narrow window, with a compact note above it; every other page is
	// the app, and the full notice replaces it. Decided from the route, so the server and the browser agree.
	const landing = $derived(page.route.id === '/');
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{#if landing}<DesktopOnlyNotice compact />{/if}
<div class="page" class:landing>{@render children()}</div>
{#if !landing}<DesktopOnlyNotice />{/if}

<style>
	/* Spec §2: desktop only. CSS switches, so a narrow window never flashes the page first.
	   Keep in step with DesktopOnlyNotice.svelte: the notice shows under this same width. */
	@media (width < 900px) {
		.page:not(.landing) {
			display: none;
		}
	}
</style>
