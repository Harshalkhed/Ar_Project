# PROJECT.md — AR Interiors SDK

Product goals, approved phases and quality bar for the web-based AR platform. `PRD.md` is the product spec, `Architecture.md` is the technical decision record, and this file is the business direction and current plan. Read this before choosing the next slice of work.

Approved by the product owner on 2026-11-14. Full research and market study: https://claude.ai/artifact/3TvjUSj9e48nHHoYGabTs4

## What we are building

A browser-based AR platform for interiors. People scan a printed brochure (image tracking) or a QR code, and the 3D content opens in their phone browser with no app install. Content includes products, show pieces, wall art and 3D floor plans. People can also place items in their own home at real size before buying.

**Who we sell to first:** exhibitors at the AD (Architectural Digest) Design Show in Mumbai, Bengaluru and Hyderabad and at Design Mumbai, plus construction and real-estate companies with brochures and floor plans.

**Delivery model:** our own web app on our own domain. No native app and no vendor AR SDK. Clients get a stable URL and QR code, hosting, analytics and updates. They don't get the editor or the source.

## Platform status (verified on real devices)

| Capability | Page | Android (Chrome) | iPhone (Safari) | Verified |
|---|---|---|---|---|
| Image tracking: brochure page → 3D content (in-house engine) | `ar.html` | Not yet device-tested | ✅ Detection, smoothing, pinch-to-scale, Reset | iPhone 2026-09-23 |
| Room placement: model fixed in the room | `webxr.html` (also via the home page's AR button) | ✅ WebXR at real size: tap the floor spot to place it there, WebXR anchors keep it on the floor, drag to turn | ✅ AR Quick Look at real size, pre-baked USDZ (one tap), no resizing; Safari and Chrome | Android 2026-11-14 · iPhone 2026-11-14 |
| Wall art: piece hung on a wall | `webxr.html?project=projects/wall-art/project.json` | Built (WebXR wall hits), not yet device-tested | ✅ Quick Look wall anchoring, flat and upright | iPhone 2026-11-14 |
| Device capability check | `check.html` | ✅ | n/a (shows Quick Look path) | — |
| Room scan + placement that refuses walls/scanned objects (native iOS, `apps/ios-placement`) | Xcode app target | n/a | Written 2026-11-16, not yet compiled or device-tested (needs a Mac and an iPhone; LiDAR for the mesh, planes only without) | — |
| Hosting | Vercel static site (`apps/preview/site`) | ✅ | ✅ | — |

**Settled platform split:** our engine for image tracking on every phone, WebXR on Android Chrome, and AR Quick Look on iPhone. iOS Safari has no WebXR, so iPhone room placement always goes through Quick Look. See `Architecture.md`, 2026-10-02.

**Still unchecked:** anything on an ARCore-certified Android phone (the Android phone tested on 2026-11-14 reports no WebXR AR support); image tracking on Android; Quick Look return-to-page state, exact placed size and export time on older iPhones; low light, distance and angle extremes; printed brochure stock (matte vs gloss).

## Approved phases

| Phase | Goal | Done when |
|---|---|---|
| **1 · Now** | Brochure AR for design shows: scan a page or QR to see a 3D product or floor plan, with hotspots and scaling | 2–3 paying exhibitors live at one show edition |
| **2 · Next** | Place decor in your home: wall art, mirrors, show pieces and furniture at real size, with variants | One art or decor brand using it on product pages and at their stall |
| **3 · Later** | Wall understanding for wallpaper designers: wallpaper on a real wall, wall width/height/openings, recesses and curves flagged | Measurements within an agreed tolerance on test walls (iPhone may need a native or photo-based method; Safari has no depth or plane API) |
| **4 · Future** | AI agent on top of the SDK | Agent works on metadata only, and proprietary 3D files never leave our storage |

## Quality bar: mobile and website come first

This product is only a web app, so the phone browser experience is the product. Treat these as requirements, not polish.

### Mobile AR runtime
- **Load:** first useful UI in under 3 s on a mid-range Android over 4G. Show a progress indicator for every asset over 1 MB.
- **Asset budget:** standard experiences around 2–5 MB. Compress GLBs (meshopt or Draco geometry, KTX2 textures) and cap textures at 2048 px (1024 px on low-end phones).
- **iPhone:** ship a pre-baked USDZ for each product so Quick Look opens instantly. On-device export stays as a fallback only (the floorplan takes about 30 s and 50 MB today).
- **Tracking:** move detection into a Web Worker, add optical-flow tracking between full detections, and calibrate camera intrinsics. Aim for steady 30 fps rendering and target detection within 5 s.
- **Entry flow:** QR codes open Safari or Chrome. Detect in-app browsers (Instagram, WhatsApp, LinkedIn) and show a clear "Open in browser" step.
- **States:** every failure (camera denied, unsupported device, asset failed, tracking lost) gets a visible, recoverable screen. Never a blank camera view.
- **Ergonomics:** safe-area insets, thumb-reachable controls, 44 px minimum touch targets, and no accidental page zoom while pinching.
- **Compass/direction:** `deviceorientationabsolute` on Android, `webkitCompassHeading` after a permission tap on iOS. Label it as approximate, because indoor readings drift.

### Showcase website
- **Core Web Vitals on mobile:** LCP < 2.5 s, INP < 200 ms, CLS < 0.1. Check them on real phones, not only in Lighthouse.
- **Pages:** home with a live "scan this page" demo; use cases (show exhibitors, builders' floor plans, art and decor brands, wallpaper designers); 3–4 demos; how it works; packages; contact.
- **Design:** premium and editorial in the style of AD Design Show audiences. Mobile layout first, then desktop. Use responsive images (AVIF/WebP), lazy-load 3D, and don't load heavy assets above the fold.
- **Every client experience** has a stable URL, so printed QR codes keep working after content updates.
- **Accessibility:** WCAG 2.1 AA contrast, keyboard access, and alt text for demo imagery.

## Protecting client designs
- Source files (FBX, Blender, CAD) never ship. Only optimised, view-only GLB and USDZ derivatives are delivered.
- Client assets are served through short-lived signed URLs, not public links. Today `apps/preview/public/projects/` is public, so use it only for publishable demo assets.
- The future AI agent works on metadata (name, size, category, placement rules), not geometry or textures. Any model that touches assets is self-hosted, and every access is logged.

## Commercial direction (to validate with 3–5 prospects)

| Package | Includes | Price to test |
|---|---|---|
| Show Starter | 1 brochure page → 1 product, QR, hosting for the show + 1 month, scan analytics | ₹40k–75k |
| Show Pro | Up to 5 pages/products, hotspots, branded landing page, 3 months hosting | ₹1–2.5 lakh |
| Builder Floor Plan | 3D floor plan on brochure + room-placement view, compass, 6 months hosting | ₹2–5 lakh |
| Hosting & updates | Content swaps behind the same QR, analytics | ₹3k–8k / month |

**Market reference (2026):** ZapWorks $35–99 per seat per month; Blippar SDK from $0.01 per 1,000 views; studio WebAR $8k–40k globally; Indian AR studios from ₹2 lakh per project. 8th Wall closed its hosted platform on 2026-02-28 (hosting ends 2027-02-28), and agencies are migrating.

**Our differentiators:** no per-view fees, iPhone and Android support, client files stay private, fast turnaround for show deadlines, and QR codes that survive content updates.

## Next 30 days (engineering backlog for Claude Code)

1. Test image tracking on Android and record the results in `Architecture.md`.
2. Move image detection into a Web Worker, then add optical-flow tracking between detections.
3. Build an asset pipeline script: GLB compression (meshopt/KTX2) plus a pre-baked USDZ per project, with Quick Look using the USDZ when present.
4. Add in-app-browser detection with an "Open in browser" screen on `ar.html` and `webxr.html`.
5. Prototype wall-art placement: WebXR `plane-detection` vertical planes on Android (Chrome 147+), and vertical placement in Quick Look on iOS.
6. Build three demo projects: show piece, wall art, builder floor plan. *(Built 2026-11-14: `demos.html`, printable brochure pages with QR codes; scan images are placeholders until real brochure artwork.)*
7. Build the showcase website (new app or pages in `apps/`) to the quality bar above.
8. Add scan analytics events (`runtime_initialized`, `target_found`, placement, dwell time).

**Business tasks (not code):** confirm the next AD Design Show and Design Mumbai dates and exhibitor contacts, and pitch the packages to 3–5 exhibitors.

## Open decisions
- Custom domain name for the showcase site and client experiences.
- Analytics stack and storage for private client assets (open in `PRD.md`).
- Phase 3 method on iPhone: native app vs photo-based measurement.
- Whether the native iOS room-placement app (`apps/ios-placement`, built 2026-11-16 because Quick Look exposes no room geometry) ships to clients, which would change the "no native app" delivery model, need an Apple developer account and a distribution path (TestFlight or App Store), and a Mac to build.
