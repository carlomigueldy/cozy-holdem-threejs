import { chromium } from 'playwright';

const url = process.env.SMOKE_URL ?? 'http://127.0.0.1:5178/';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const logs = [];
const errors = [];
page.on('console', (msg) => logs.push(`${msg.type()}: ${msg.text()}`));
page.on('pageerror', (error) => errors.push(error.message));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hearthsideDebug?.ready === true, null, { timeout: 10000 });
const title = await page.title();
const initial = await page.evaluate(() => window.__hearthsideDebug.state());
const canvasSize = await page.evaluate(() => window.__hearthsideDebug.canvasSize());
if (!title.includes('Hearthside')) throw new Error(`Unexpected title: ${title}`);
if (canvasSize.width < 1000 || canvasSize.height < 700) throw new Error(`Canvas too small: ${JSON.stringify(canvasSize)}`);
if (initial.players.length !== 6) throw new Error(`Expected 6 players, received ${initial.players.length}`);
if (initial.stage !== 'preflop') throw new Error(`Expected preflop, received ${initial.stage}`);
if (initial.communityCards.length !== 0) throw new Error('Community cards should be empty preflop');
if (initial.players[0].holeCards.length !== 2) throw new Error('Human should see two hole cards');
if (initial.players.slice(1).some((player) => !player.holeCardsHidden)) throw new Error('Bot cards should be hidden before showdown');

await page.getByRole('button', { name: /Check|Call/ }).click({ timeout: 8000 });
await page.waitForTimeout(1900);
const afterAction = await page.evaluate(() => window.__hearthsideDebug.state());
if (!['preflop', 'flop', 'turn', 'river', 'showdown', 'hand-complete'].includes(afterAction.stage)) {
  throw new Error(`Invalid stage after action: ${afterAction.stage}`);
}

await page.getByRole('button', { name: /New Hand|Redeal/ }).click();
await page.waitForTimeout(900);
const afterNewHand = await page.evaluate(() => window.__hearthsideDebug.state());
if (afterNewHand.handNumber <= initial.handNumber) throw new Error('New hand button did not increment hand number');
if (afterNewHand.players[0].holeCards.length !== 2) throw new Error('Human should receive two new cards');

const screenshotPath = 'docs/browser-smoke.png';
await page.screenshot({ path: screenshotPath, fullPage: true });
await browser.close();

console.log(JSON.stringify({
  ok: true,
  title,
  initialStage: initial.stage,
  afterActionStage: afterAction.stage,
  afterNewHand: afterNewHand.handNumber,
  pot: afterNewHand.pot,
  canvasSize,
  logs: logs.slice(-8),
  errors,
  screenshotPath,
}, null, 2));

if (errors.length > 0) process.exit(1);
