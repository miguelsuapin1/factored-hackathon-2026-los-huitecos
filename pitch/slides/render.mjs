// Render the pitch slides to PNG at 2000 x 1125: `node render.mjs turn data case` (names of the .html files here).
// Uses Chrome/Chromium through playwright-core: CHROME_PATH if set, else the Playwright browser in /opt/pw-browsers
// (Claude Code cloud sessions), else the installed Google Chrome. Web requests are blocked so the run is offline and
// repeatable: fonts come from node_modules (slide.css), not Google Fonts.
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import path from "node:path";

const dir = path.dirname(new URL(import.meta.url).pathname);
const names = process.argv.slice(2);
if (names.length === 0) {
  console.error("usage: node render.mjs turn data case");
  process.exit(1);
}
const exe = [process.env.CHROME_PATH, "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find((p) => p && existsSync(p));
const browser = await chromium.launch(exe ? { executablePath: exe } : { channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 2000, height: 1125 }, deviceScaleFactor: 1 });
await page.route(/^https?:\/\//, (route) => route.abort());
for (const name of names) {
  await page.goto("file://" + path.join(dir, name + ".html"));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  // Flag text that spills out of its box, so an edit that no longer fits is caught before it ships.
  const overflow = await page.evaluate(() =>
    [...document.querySelectorAll(".card, .callout, .rule, .pill, .band, .quarantine, .inner")]
      .filter((el) => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)
      .map((el) => `${el.className}: ${el.textContent.trim().slice(0, 60)}`),
  );
  console.log(name, overflow.length ? { overflow } : "ok");
  await page.screenshot({ path: path.join(dir, "..", `${name === "turn" ? "architecture-turn" : name === "data" ? "architecture-data" : "handoff-case"}.png`) });
}
await browser.close();
