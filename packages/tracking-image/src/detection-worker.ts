// Worker entry: target compilation and per-frame detection run here, off the main thread,
// so rendering and touch gestures stay responsive while the CV pipeline works.
import { grayscaleFromRgba, type GrayImage } from '@internal-webar/tracking-image-engine';
import { createDetectionHandler, type DetectionRequest, type DetectionReply } from './detection-protocol.js';

async function loadGrayImage(uri: string): Promise<GrayImage> {
  const response = await fetch(uri);
  if (!response.ok) throw new Error(`${uri} returned HTTP ${response.status}.`);
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d');
    if (!context) throw new Error('2D canvas context is unavailable in the detection worker.');
    context.drawImage(bitmap, 0, 0);
    return grayscaleFromRgba(context.getImageData(0, 0, bitmap.width, bitmap.height).data, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

// This package compiles with the DOM lib, where `self` is typed as Window; describe the worker scope we use.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<DetectionRequest>) => void) | null;
  postMessage(message: DetectionReply): void;
};
const handle = createDetectionHandler(loadGrayImage);
scope.onmessage = (event) => {
  void handle(event.data).then((reply) => {
    if (reply) scope.postMessage(reply);
  });
};
