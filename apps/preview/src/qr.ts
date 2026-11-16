import QRCode from 'qrcode';

/**
 * Inline SVG QR code for a link on this site. The link is made absolute from the page's own address,
 * so printed codes always point at the domain the page was served from (and follow a domain change).
 */
export async function qrSvg(relativeLink: string, label: string): Promise<string> {
  const url = new URL(relativeLink, location.href).href;
  const svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#111111', light: '#ffffff' } });
  return svg.replace('<svg ', `<svg role="img" aria-label="${label.replace(/"/g, '&quot;')}" `);
}
