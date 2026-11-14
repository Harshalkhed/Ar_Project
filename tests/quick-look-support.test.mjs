import test from 'node:test';
import assert from 'node:assert/strict';
import { isQuickLookBrowser } from '../apps/preview/dist/quick-look-support.js';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)';

test('Safari on iOS is trusted through relList.supports("ar")', () => {
  assert.equal(isQuickLookBrowser(`${IPHONE} Version/18.1 Mobile/15E148 Safari/604.1`, true), true);
});

test('Chrome, Edge and Firefox on iOS open Quick Look even though their relList check says false', () => {
  for (const ua of [
    `${IPHONE} CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1`,
    `${IPHONE} EdgiOS/131.0.2903.68 Version/18.0 Mobile/15E148 Safari/604.1`,
    `${IPHONE} FxiOS/133.0 Mobile/15E148 Safari/605.1.15`,
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Safari/604.1', // iPad, desktop-style UA
  ]) assert.equal(isQuickLookBrowser(ua, false), true, ua);
});

test('Android Chrome, desktop Chrome and iOS in-app browsers do not count', () => {
  for (const ua of [
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    `${IPHONE} Mobile/15E148 Instagram 309.0.0.27.111 (iPhone15,2; iOS 18_1; en_US)`,
  ]) assert.equal(isQuickLookBrowser(ua, false), false, ua);
});
