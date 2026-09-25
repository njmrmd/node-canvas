<script lang="ts">
	import Shell from '$lib/components/Shell.svelte';
</script>

<svelte:head><title>Canvas · node-canvas</title></svelte:head>
<Shell>
	<h1>Canvas</h1>
	<!-- /keys does not exist until Task 9; resolve() cannot type-check an unknown route yet. -->
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
	<p>The canvas arrives in Plan 2. <a href="/keys">Manage your key</a></p>
</Shell>
