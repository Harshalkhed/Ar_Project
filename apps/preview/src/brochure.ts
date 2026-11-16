// brochure.html?demo=<id>: one printable A4 brochure page per demo. The large picture is the scan image
// the phone tracks; the QR code opens the scan page, which also offers room placement.
import { DEMOS, demoById, demoLinks } from './demos.js';
import { qrSvg } from './qr.js';

const sheet = document.querySelector<HTMLElement>('#sheet');
document.querySelector('#print')?.addEventListener('click', () => window.print());

// On screens narrower than an A4 sheet, scale the sheet to fit instead of scrolling sideways. Print is
// unaffected: the print stylesheet resets zoom.
const fitSheet = (): void => {
  if (!sheet) return;
  sheet.style.zoom = '';
  const available = document.documentElement.clientWidth - 16;
  if (sheet.offsetWidth > available) sheet.style.zoom = String(available / sheet.offsetWidth);
};
window.addEventListener('resize', fitSheet);
fitSheet();

async function render(): Promise<void> {
  if (!sheet) return;
  const demo = demoById(new URLSearchParams(location.search).get('demo'));
  if (!demo) {
    sheet.textContent = `Unknown demo. Choose one of: ${DEMOS.map((d) => d.id).join(', ')}.`;
    return;
  }
  const links = demoLinks(demo);
  document.title = `${demo.title} Brochure`;

  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'Scan to see it in 3D';
  const title = document.createElement('h1');
  title.textContent = demo.title;
  const pitch = document.createElement('p');
  pitch.className = 'pitch';
  pitch.textContent = demo.pitch;
  const image = document.createElement('img');
  image.className = 'target';
  image.src = links.target;
  image.alt = `Scan image for ${demo.title}: point your phone at this picture`;

  const scan = document.createElement('div');
  scan.className = 'scan';
  const code = document.createElement('div');
  code.className = 'code';
  code.innerHTML = await qrSvg(links.scan, `QR code to open the ${demo.title} scan`);
  const steps = document.createElement('div');
  const list = document.createElement('ol');
  for (const text of [
    'Scan the QR code with your phone camera.',
    'Tap "Point camera at target" and point your phone at the picture above.',
    `Tap "Place in your room" to see it at real size (${demo.placeHint.toLowerCase()}).`,
  ]) {
    const item = document.createElement('li');
    item.textContent = text;
    list.append(item);
  }
  const url = document.createElement('p');
  url.className = 'url';
  url.textContent = new URL(links.scan, location.href).href;
  steps.append(list, url);
  scan.append(code, steps);
  sheet.replaceChildren(eyebrow, title, pitch, image, scan);
}

render().catch((error: unknown) => {
  if (sheet) sheet.textContent = `Could not build the brochure page: ${error instanceof Error ? error.message : String(error)}`;
  console.error(error);
});
