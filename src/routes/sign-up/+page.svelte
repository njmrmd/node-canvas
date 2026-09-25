<script lang="ts">
	import AuthForm from '$lib/components/AuthForm.svelte';
	import Shell from '$lib/components/Shell.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>Create an account · node-canvas</title></svelte:head>
<Shell><AuthForm mode="sign-up" next={data.next} {form} /></Shell>
