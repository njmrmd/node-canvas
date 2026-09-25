export type AuthMode = 'sign-up' | 'sign-in';

export const AUTH_COPY = {
	'sign-up': {
		title: 'Create an account',
		subheading:
			'You bring your own model access. We never see your provider bill, and you can delete everything in one click.',
		submit: 'Create account',
		busy: 'Creating account…',
		passwordHint: 'At least 10 characters. Length beats punctuation.',
		passwordNote:
			'There is no password reset yet. If you lose this password, you lose the account and the key stored with it — save it in your password manager now.',
		footer: 'Already have an account?',
		footerLink: 'Sign in',
		footerHref: '/sign-in',
		autocomplete: 'new-password'
	},
	'sign-in': {
		title: 'Sign in',
		subheading: 'Welcome back.',
		submit: 'Sign in',
		busy: 'Signing in…',
		passwordHint: undefined,
		passwordNote: undefined,
		footer: 'No account yet?',
		footerLink: 'Create one',
		footerHref: '/sign-up',
		autocomplete: 'current-password',
		recovery:
			'Forgotten your password? We cannot reset it yet — that is a gap on our side, not a policy. The way back in is a new account, and you will need to reconnect your model key.'
	}
} as const;

export const AUTH_MESSAGES = {
	emailTaken: 'An account already exists for that email. Try signing in instead.',
	badCredentials: 'That email and password do not match.'
} as const;

export const KEYS_COPY = {
	title: 'Connect your model access',
	trust: [
		'Encrypted before it is stored, with a key held only by the server.',
		'Never sent back to this browser. No route returns it, not even to you.',
		'Every model call is made server-side, so the key never touches this page.',
		'Deleting your account deletes the key in the same transaction.'
	],
	keyLabel: 'Anthropic API key',
	keyHint: 'From console.anthropic.com → API keys. It starts with sk-ant-.',
	connect: 'Verify and save key',
	replace: 'Verify and replace key',
	verifying: 'Checking with Anthropic…',
	connected: (last4: string) => `Connected — key ending ${last4}`,
	notConnected: 'No key connected yet.',
	saved: 'Key verified and saved',
	remove: 'Remove key',
	emptyKey: 'Paste your Anthropic API key.',
	longKey: 'That is longer than any Anthropic API key. Check what you pasted.',
	openCanvas: 'Open the canvas',
	signOut: 'Sign out',
	deleteHeading: 'Delete this account',
	deleteBody:
		'Removes the account, every session, and the stored key in one transaction. This cannot be undone and there is no export.',
	deleteProvider: 'Your key stays valid at the provider — revoke it there too if you want it dead.',
	deleteConfirm: 'I understand this deletes everything',
	deleteButton: 'Delete account',
	deleteUnconfirmed: 'Tick the box to confirm.'
} as const;
