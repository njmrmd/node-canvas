<script lang="ts">
	import { page } from '$app/state';
	import favicon from '$lib/assets/favicon.svg';
	import DesktopOnlyNotice from '$lib/components/DesktopOnlyNotice.svelte';
	import { LANDING_COPY } from '$lib/copy/landing';
	import '$lib/styles/tokens.css';
	import '$lib/styles/base.css';

	let { children } = $props();
	// The landing page stays readable on a narrow window, with a compact note above it; every other page is
	// the app, and the full notice replaces it. Decided from the route, so the server and the browser agree.
	const landing = $derived(page.route.id === '/');
	const origin = $derived(page.url.origin);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<!-- The link card, as Slack, Messages and X unfurl it. Absolute URLs from this request's origin. -->
	<meta name="description" content={LANDING_COPY.description} />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="node-canvas" />
	<meta property="og:title" content={LANDING_COPY.ogTitle} />
	<meta property="og:description" content={LANDING_COPY.description} />
	<meta property="og:url" content="{origin}/" />
	<meta property="og:image" content="{origin}/og.png" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:image:alt" content={LANDING_COPY.ogImageAlt} />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={LANDING_COPY.ogTitle} />
	<meta name="twitter:description" content={LANDING_COPY.description} />
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
