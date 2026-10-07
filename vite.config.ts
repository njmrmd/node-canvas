import adapter from '@sveltejs/adapter-vercel';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
	// Server code reads process.env (so node:test can load it). Vite only fills
	// import.meta.env from .env, so copy .env into process.env for dev/preview.
	// Real environment variables always win.
	for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), ''))) {
		process.env[key] ??= value;
	}

	return {
		plugins: [
			sveltekit({
				compilerOptions: {
					runes: ({ filename }) =>
						filename.split(/[/\\]/).includes('node_modules') ? undefined : true
				},
				adapter: adapter(),
				// The generated tsconfig covers src/ and tests/ only: add scripts/*.ts (pnpm og:image) to what
				// `pnpm check` type-checks.
				typescript: {
					config: (config) => {
						config.include.push('../scripts/**/*.ts');
					}
				},
				csp: {
					mode: 'auto',
					directives: {
						'default-src': ['self'],
						'script-src': ['self'],
						'style-src': ['self', 'unsafe-inline'],
						'img-src': ['self', 'data:', 'blob:'],
						'font-src': ['self'],
						'connect-src': ['self'],
						'object-src': ['none'],
						'base-uri': ['self'],
						'form-action': ['self'],
						'frame-ancestors': ['none']
					}
				}
			})
		]
	};
});
