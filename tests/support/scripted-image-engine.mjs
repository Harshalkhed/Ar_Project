// Test double for the ImageTrackingEngine seam. It records calls and lets tests
// drive engine callbacks; it does not simulate camera recognition.
export class ScriptedImageEngine {
  loadedUris = [];
  startCount = 0;
  stopCount = 0;
  callbacks = undefined;
  loadError = undefined;
  startError = undefined;

  async loadTargets(imageUris) {
    if (this.loadError) throw this.loadError;
    this.loadedUris = [...imageUris];
  }

  async start(callbacks) {
    if (this.startError) throw this.startError;
    this.startCount += 1;
    this.callbacks = callbacks;
  }

  async stop() {
    this.stopCount += 1;
    this.callbacks = undefined;
  }
}

export const supportedEnvironment = { isSecureContext: true, hasCamera: true };

export function domError(name) {
  const error = new Error(`${name} raised by camera`);
  error.name = name;
  return error;
}
