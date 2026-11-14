import {
  compileImageTarget,
  grayscaleFromRgba,
  LiveImageTracker,
  type CameraIntrinsics,
  type GrayImage,
  type LiveTrackerEvent,
} from '@internal-webar/tracking-image-engine';

export interface FrameIntrinsics extends CameraIntrinsics {
  readonly width: number;
  readonly height: number;
}

/** Main thread → detection worker. `rgba` is transferred, not copied. */
export type DetectionRequest =
  | { readonly type: 'load'; readonly uris: readonly string[] }
  | { readonly type: 'frame'; readonly session: number; readonly rgba: Uint8ClampedArray; readonly intrinsics: FrameIntrinsics }
  | { readonly type: 'reset' };

/** Detection worker → main thread. `session` lets the engine drop replies from before a stop/start. */
export type DetectionReply =
  | { readonly type: 'loaded' }
  | { readonly type: 'events'; readonly session: number; readonly events: LiveTrackerEvent[] }
  | { readonly type: 'error'; readonly message: string };

/**
 * The detection worker's message handling, kept free of worker globals so it runs in Node tests.
 * `loadImage` decodes a target URI to grayscale (in the worker: fetch + OffscreenCanvas).
 */
export function createDetectionHandler(loadImage: (uri: string) => Promise<GrayImage>): (request: DetectionRequest) => Promise<DetectionReply | undefined> {
  let tracker: LiveImageTracker | undefined;
  return async (request) => {
    try {
      switch (request.type) {
        case 'load': {
          const images = await Promise.all(request.uris.map(loadImage));
          tracker = new LiveImageTracker(images.map(compileImageTarget));
          return { type: 'loaded' };
        }
        case 'frame': {
          if (!tracker) return { type: 'error', message: 'Detection frame received before targets were loaded.' };
          const { width, height } = request.intrinsics;
          const events = tracker.processFrame(grayscaleFromRgba(request.rgba, width, height), request.intrinsics);
          return { type: 'events', session: request.session, events };
        }
        case 'reset':
          tracker?.reset();
          return undefined;
      }
    } catch (error) {
      return { type: 'error', message: error instanceof Error ? error.message : String(error) };
    }
  };
}
