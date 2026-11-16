// demos.html: the three sales demos with their scan, room and brochure links, plus a QR code each.
import { DEMOS, demoLinks } from './demos.js';
import { qrSvg } from './qr.js';

const list = document.querySelector<HTMLDivElement>('#demos');

function link(href: string, text: string, kind: 'primary' | 'secondary'): HTMLAnchorElement {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.textContent = text;
  anchor.className = kind;
  return anchor;
}

async function render(): Promise<void> {
  if (!list) return;
  for (const demo of DEMOS) {
    const links = demoLinks(demo);
    const card = document.createElement('article');
    const image = document.createElement('img');
    image.className = 'target';
    image.src = links.target;
    image.alt = `Brochure scan image for ${demo.title}`;
    image.loading = 'lazy';
    image.width = 900;
    image.height = 1200;

    const body = document.createElement('div');
    body.className = 'body';
    const title = document.createElement('h2');
    title.textContent = demo.title;
    const pitch = document.createElement('p');
    pitch.className = 'pitch';
    pitch.textContent = demo.pitch;
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = `Room placement: ${demo.placeHint}.`;
    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.append(link(links.scan, 'Scan the brochure page', 'primary'), link(links.room, 'Place in your room', 'secondary'), link(links.brochure, 'Print the brochure page', 'secondary'));
    const qr = document.createElement('div');
    qr.className = 'qr';
    qr.innerHTML = await qrSvg(links.scan, `QR code: scan the ${demo.title} brochure page`);
    qr.append('Scan with your phone camera to open the brochure scan.');
    body.append(title, pitch, hint, actions, qr);
    card.append(image, body);
    list.append(card);
  }
}

render().catch((error: unknown) => {
  if (list) list.textContent = `Could not show the demos: ${error instanceof Error ? error.message : String(error)}`;
  console.error(error);
});
