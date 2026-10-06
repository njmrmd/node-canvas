<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import DesktopOnlyNotice from '$lib/components/DesktopOnlyNotice.svelte';
	import '$lib/styles/tokens.css';
	import '$lib/styles/base.css';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="page">{@render children()}</div>
<DesktopOnlyNotice />

<style>
	/* Spec §2: desktop only. CSS switches, so a narrow window never flashes the page first.
	   Keep in step with DesktopOnlyNotice.svelte: the notice shows under this same width. */
	@media (width < 900px) {
		.page {
			display: none;
		}
	}
</style>
