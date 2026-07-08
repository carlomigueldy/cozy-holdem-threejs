import { chromium } from 'playwright';

const url = process.env.SMOKE_URL ?? 'http://127.0.0.1:5178/';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
const jsErrors = [];
const failedRequests = [];
page.on('pageerror', (error) => jsErrors.push(error.stack ?? error.message));
page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hearthsideDebug?.ready === true, null, { timeout: 10000 });
await page.waitForFunction(() => window.__hearthsideDebug.state().legalActions.isPlayerTurn === true, null, { timeout: 10000 });
await page.evaluate(() => document.getElementById('callBtn')?.click());
await page.waitForTimeout(1200);
const state = await page.evaluate(() => window.__hearthsideDebug.state());
await browser.close();
console.log(JSON.stringify({ ok: jsErrors.length === 0, jsErrors, failedRequests, stage: state.stage, handNumber: state.handNumber }, null, 2));
if (jsErrors.length > 0) process.exit(1);
