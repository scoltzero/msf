import { createWaveRenderer, type WaveMessage } from "./gradient-waves-renderer";

let renderer: ReturnType<typeof createWaveRenderer> | undefined;
self.onmessage = (event: MessageEvent<WaveMessage>) => {
  try {
    const message = event.data;
    if (message.type === "init") {
      renderer?.dispose();
      renderer = createWaveRenderer(message.canvas, message.frame, message.powerPreference);
      self.postMessage({ type: "ready" });
    } else renderer?.update(message.frame);
  } catch {
    renderer?.dispose();
    renderer = undefined;
    self.postMessage({ type: "failed" });
  }
};

