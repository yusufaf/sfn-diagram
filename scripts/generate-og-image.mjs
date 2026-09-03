#!/usr/bin/env node
/**
 * Generate the site-wide Open Graph / Twitter card image and the GitHub social
 * preview image. Both platforms want a single 1200x630 PNG, so one render
 * covers both — the GitHub one still has to be uploaded by hand under repo
 * Settings > Social preview (there's no API for it).
 *
 * Usage: pnpm run og:image
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import nodeHtmlToImage from 'node-html-to-image';
import { generateSvg } from '../dist/index.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WIDTH = 1200;
const HEIGHT = 630;

const fixturePath = join(repoRoot, 'examples', 'order-processing.asl.json');
const aslDefinition = JSON.parse(readFileSync(fixturePath, 'utf-8'));
const { svg } = generateSvg({ aslDefinition, layout: 'LR', theme: 'light' });

const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${WIDTH}px;
    height: ${HEIGHT}px;
    background: linear-gradient(160deg, #16202b 0%, #1b2a38 55%, #14212c 100%);
    display: flex;
    flex-direction: column;
    justify-content: center;
    font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;
    color: #f5f7fa;
    padding: 64px 72px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 22px;
  }
  .brand-mark {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: #24714b;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
  }
  .brand-name {
    font-size: 26px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  h1 {
    font-size: 44px;
    font-weight: 700;
    line-height: 1.18;
    letter-spacing: -0.015em;
    max-width: 920px;
    margin-bottom: 34px;
  }
  .diagram-frame {
    background: #ffffff;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 14px;
    padding: 22px 28px;
    display: inline-flex;
    align-self: flex-start;
    box-shadow: 0 18px 40px rgba(0, 0, 0, 0.35);
  }
  .diagram-frame svg {
    display: block;
    height: 190px;
    width: auto;
  }
</style>
</head>
<body>
  <div class="brand">
    <div class="brand-mark">🧩</div>
    <div class="brand-name">sfn-diagram</div>
  </div>
  <h1>Turn any Step Functions state machine into a diagram —<br>SVG, Mermaid, HTML, or PNG.</h1>
  <div class="diagram-frame">${svg}</div>
</body>
</html>
`.trim();

const buffer = await nodeHtmlToImage({
    html,
    puppeteerArgs: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        defaultViewport: { width: WIDTH, height: HEIGHT },
    },
    quality: 100,
    type: 'png',
});

const outputs = [join(repoRoot, 'site', 'public', 'og.png'), join(repoRoot, 'docs', 'images', 'og.png')];

for (const outputPath of outputs) {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, buffer);
    console.log(`✓ ${outputPath} (${WIDTH}x${HEIGHT}px)`);
}
