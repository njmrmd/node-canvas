/**
 * Renders the link-preview picture, `static/og.png` (1200 × 630), from the landing page's own drawing and
 * copy, in Playwright's pinned Chromium. Run it after changing either: `pnpm og:image`, then commit the PNG.
 * Never edit the PNG by hand.
 */
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { LANDING_COPY } from '../src/lib/copy/landing';
import { drawingSvg } from '../src/lib/landing/drawing';

const WIDTH = 1200;
const HEIGHT = 630;
/** The light theme's values from src/lib/styles/tokens.css: the card is the landing page, not the canvas. */
const COLORS = { background: '#ffffff', hairline: '#e4e4e7', muted: '#71717a', foreground: '#18181b' };

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
	body { margin: 0; width: ${WIDTH}px; height: ${HEIGHT}px; box-sizing: border-box; padding: 0 64px;
		display: flex; align-items: center; justify-content: space-between;
		background: ${COLORS.background}; color: ${COLORS.foreground};
		font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif; }
	.text { max-width: 540px; }
	.eyebrow { margin: 0 0 28px; font: 500 20px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
		letter-spacing: 0.18em; text-transform: uppercase; color: ${COLORS.muted}; }
	h1 { margin: 0 0 28px; font-size: 58px; line-height: 1.05; letter-spacing: -0.02em; }
	.lede { margin: 0; max-width: 340px; font-size: 24px; line-height: 1.4; color: ${COLORS.muted}; }
</style></head>
<body>
	<div class="text">
		<p class="eyebrow">${LANDING_COPY.eyebrow}</p>
		<h1>${LANDING_COPY.headline}</h1>
		<p class="lede">${LANDING_COPY.ogLede}</p>
	</div>
	${drawingSvg(COLORS, { width: 432, height: 240 })}
</body></html>`;

const browser = await chromium.launch();
try {
	const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
	await page.setContent(html);
	await writeFile('static/og.png', await page.screenshot({ type: 'png' }));
} finally {
	await browser.close();
}
console.log(`Wrote static/og.png (${WIDTH} × ${HEIGHT}).`);
