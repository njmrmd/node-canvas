<script lang="ts">
	import AuthForm from '$lib/components/AuthForm.svelte';
	import Shell from '$lib/components/Shell.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>Sign in · node-canvas</title></svelte:head>
<Shell><AuthForm mode="sign-in" next={data.next} {form} /></Shell>
