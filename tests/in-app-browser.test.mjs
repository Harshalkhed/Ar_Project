import test from 'node:test';
import assert from 'node:assert/strict';
import { chromeIntentUrl, detectInAppBrowser } from '../apps/preview/dist/in-app-browser.js';

const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const ANDROID_WV = 'Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.144 Mobile Safari/537.36';

test('detects apps that name themselves in their web view user agent', () => {
  const cases = [
    [`${IOS} Instagram 309.0.0.27.111 (iPhone15,2; iOS 17_1; en_US; en; scale=3.00; 1179x2556; 534154484)`, 'Instagram', 'ios'],
    [`${ANDROID_WV} Instagram 312.0.0.33.111 Android (34/14; 480dpi; 1080x2340; samsung; SM-S918B)`, 'Instagram', 'android'],
    [`${IOS} [FBAN/FBIOS;FBAV/443.0.0.42.112;FBBV/550000000;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/17.1;FBSS/3;FBLC/en_US]`, 'Facebook', 'ios'],
    [`${ANDROID_WV} [FB_IAB/FB4A;FBAV/445.0.0.34.118;]`, 'Facebook', 'android'],
    [`${IOS} [FBAN/MessengerForiOS;FBAV/440.0.0.30.110;FBBV/540000000;FBDV/iPhone15,2]`, 'Messenger', 'ios'],
    [`${ANDROID_WV} [FB_IAB/Orca-Android;FBAV/440.0.0.30.110;]`, 'Messenger', 'android'],
    [`${IOS} [LinkedInApp]/9.29.8040`, 'LinkedIn', 'ios'],
    [`${IOS} WhatsApp/2.24.1.78`, 'WhatsApp', 'ios'],
    [`${ANDROID_WV} musical_ly_2023203030 JsSdk/1.0 NetType/WIFI Channel/googleplay AppName/musical_ly app_version/32.3.3 ByteLocale/en BytedanceWebview/d8a21c6`, 'TikTok', 'android'],
    [`${IOS} Snapchat/12.65.0.36 (like Safari/8617.1.17.10.12, panda)`, 'Snapchat', 'ios'],
    [`${IOS} MicroMessenger/8.0.44(0x18002c2f) NetType/WIFI Language/zh_CN`, 'WeChat', 'ios'],
  ];
  for (const [userAgent, app, platform] of cases) assert.deepEqual(detectInAppBrowser(userAgent), { app, platform }, app);
});

test('flags an unnamed Android web view, but not real browsers', () => {
  assert.deepEqual(detectInAppBrowser(ANDROID_WV), { app: null, platform: 'android' });
  const browsers = [
    `${IOS.replace('Mobile/15E148', 'Version/17.1 Mobile/15E148 Safari/604.1')}`, // Safari (also what Safari View Controller reports)
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36', // Chrome and Custom Tabs
    `${IOS} CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1`, // Chrome on iPhone
    'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  ];
  for (const userAgent of browsers) assert.equal(detectInAppBrowser(userAgent), null, userAgent);
});

test('builds a Chrome intent link that keeps path and query and falls back to the page itself', () => {
  const href = 'https://ar.example.com/webxr.html?project=projects/floorplan/project.json#top';
  assert.equal(
    chromeIntentUrl(href),
    'intent://ar.example.com/webxr.html?project=projects/floorplan/project.json#Intent;scheme=https;package=com.android.chrome;' +
      `S.browser_fallback_url=${encodeURIComponent(href)};end`,
  );
});
