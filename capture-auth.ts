/**
 * Tinder auth capture — opens a real browser, intercepts all gotinder.com
 * API calls, and dumps them to tinder-captured-requests.json so we can
 * update the MCP server with the correct endpoints + headers.
 *
 * Usage: npx tsx capture-auth.ts
 * Then log in manually in the browser window that opens.
 * Close the browser when done — captured requests are saved automatically.
 */

import { chromium, type Request, type Response } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const OUTPUT_FILE = path.join(__dirname, 'tinder-captured-requests.json');
const TINDER_API = 'api.gotinder.com';

interface CapturedRequest {
  timestamp: string;
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  status: number | null;
  responseHeaders: Record<string, string>;
  responseBody: string | null;
}

const captured: CapturedRequest[] = [];

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Intercept all requests to the Tinder API
  page.on('request', (req: Request) => {
    if (!req.url().includes(TINDER_API)) return;
    console.log(`→ ${req.method()} ${req.url()}`);
  });

  page.on('requestfinished', async (req: Request) => {
    if (!req.url().includes(TINDER_API)) return;

    let responseBody: string | null = null;
    let status: number | null = null;
    let responseHeaders: Record<string, string> = {};

    try {
      const res: Response | null = await req.response();
      if (res) {
        status = res.status();
        responseHeaders = await res.allHeaders();
        const buf = await res.body();
        responseBody = buf.toString('utf-8');
      }
    } catch {
      // response may be unavailable for some request types
    }

    let requestBody: string | null = null;
    try {
      requestBody = req.postData();
    } catch {
      // no body
    }

    const entry: CapturedRequest = {
      timestamp: new Date().toISOString(),
      method: req.method(),
      url: req.url(),
      requestHeaders: await req.allHeaders(),
      requestBody,
      status,
      responseHeaders,
      responseBody,
    };

    captured.push(entry);
    console.log(`  ← ${status} (${req.url().replace('https://' + TINDER_API, '')})`);
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(captured, null, 2));
  });

  console.log('\n=== Tinder Auth Capture ===');
  console.log('Browser opening — log in manually, then close the window.');
  console.log(`Requests saving to: ${OUTPUT_FILE}\n`);

  await page.goto('https://tinder.com');

  // Wait until the browser is closed by the user
  await new Promise<void>((resolve) => {
    browser.on('disconnected', resolve);
  });

  console.log(`\nDone. Captured ${captured.length} API request(s) → ${OUTPUT_FILE}`);

  // Extract anti-bot / fingerprinting headers seen across all requests
  const ANTI_BOT_HEADERS = [
    'user-agent',
    'app-version',
    'platform',
    'x-supported-image-formats',
    'x-auth-token',
    'x-client-version',
    'persistent-device-id',
    'device-id',
    'install-id',
    'x-device-id',
    'tinder-version',
    'os-version',
    'store-variant',
    'funnel-session-id',
    'app-session-id',
    'app-session-time-elapsed',
    'is-dark-mode',
    'accept-language',
    'sec-ch-ua',
    'sec-ch-ua-mobile',
    'sec-ch-ua-platform',
  ];

  const seen: Record<string, Set<string>> = {};
  for (const req of captured) {
    for (const [k, v] of Object.entries(req.requestHeaders)) {
      if (ANTI_BOT_HEADERS.includes(k.toLowerCase())) {
        const key = k.toLowerCase();
        if (!seen[key]) seen[key] = new Set();
        seen[key].add(v);
      }
    }
  }

  console.log('\n=== Suggested .env additions ===');
  const envLines: string[] = ['\n# Tinder anti-bot fingerprinting headers'];
  for (const [header, values] of Object.entries(seen)) {
    const envKey = 'TINDER_HEADER_' + header.toUpperCase().replace(/-/g, '_');
    const value = [...values][0]; // take first seen value
    envLines.push(`${envKey}=${value}`);
    console.log(`${envKey}=${value}`);
  }

  const envBlock = envLines.join('\n');
  fs.appendFileSync(path.join(__dirname, 'tinder-captured-requests.json.env'), envBlock);
  console.log(`\nSaved to tinder-captured-requests.json.env — paste into your .env\n`);
})();
