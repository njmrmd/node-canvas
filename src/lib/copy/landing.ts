/** The landing page's words, and the link card's (Task 2). Same tone as the canvas: say what this is, then offer the way in. */
export const LANDING_COPY = {
	title: 'node-canvas — a conversation is a graph, not a list',
	eyebrow: 'node-canvas',
	headline: 'A conversation is a graph, not a list.',
	lede: 'Every exchange is a card on a canvas. Branch from any card to take an idea somewhere else, and keep the version you started with — instead of scrolling back through a thread to find where it went wrong.',
	primary: 'Create an account',
	secondary: 'Sign in',
	keyNoteBefore: 'You will need your own ',
	keyNoteLink: 'Anthropic API key',
	keyNoteAfter: '. It takes about a minute to create, and we never see your provider bill.',
	stepsHeading: 'How it works',
	steps: [
		{ title: 'Create an account', body: 'Email and password. No card, no team setup.' },
		{
			title: 'Connect an Anthropic key',
			body: 'Paste your own API key. It is encrypted before it is stored and never returned to the browser.'
		},
		{
			title: 'Branch the conversation',
			body: 'Ask something, then fork any reply into a new direction. The version you started with stays on the canvas next to it.'
		}
	],
	openSource: 'Open source, MIT licensed.',
	source: 'Source on GitHub',
	welcomeTitle: 'Welcome back.',
	welcomeBody: 'Pick up your canvas, or manage the model key it uses.',
	openCanvas: 'Open the canvas',
	manageKey: 'Manage your key',
	/** The link card (Task 2): the headline without its full stop, as a card title. */
	ogTitle: 'A conversation is a graph, not a list',
	/** The link card's picture carries a shorter lede than the page. */
	ogLede: 'Branch any reply. Keep the version you started with.',
	ogImageAlt: 'Three cards on a canvas: one card at the top branches into two below it.',
	/** The page's meta description and the link card's: the branch-and-keep clause first, so truncation never cuts it. */
	description:
		'Branch any reply into a new direction and keep the version you started with. Every exchange is a card on a canvas, not another line in a thread. Bring your own Anthropic key.'
} as const;

export const ANTHROPIC_KEYS_URL = 'https://console.anthropic.com/settings/keys';
export const SOURCE_URL = 'https://github.com/njmrmd/node-canvas';
