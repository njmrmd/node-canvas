<script lang="ts">
	import { resolve } from '$app/paths';
	import Shell from '$lib/components/Shell.svelte';
</script>

<svelte:head><title>Canvas · node-canvas</title></svelte:head>
<Shell>
	<h1>Canvas</h1>
	<p>The canvas arrives in Plan 2. <a href={resolve('/keys')}>Manage your key</a></p>
</Shell>
