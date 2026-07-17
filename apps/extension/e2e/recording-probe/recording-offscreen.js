const MESSAGE_TARGET = "chrome-bridge-recording-probe-offscreen";
const MIME_TYPES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

let recording;

function requireRecording(id) {
  if (!recording || recording.id !== id) {
    throw new Error(`Recording probe ${id} is not active`);
  }
  return recording;
}

function recorderMimeType() {
  const mimeType = MIME_TYPES.find((candidate) =>
    MediaRecorder.isTypeSupported(candidate),
  );
  if (!mimeType) throw new Error("No WebM MediaRecorder codec is available");
  return mimeType;
}

async function start(message) {
  if (recording) throw new Error("Another recording probe is active");
  const canvas = document.createElement("canvas");
  canvas.width = message.width;
  canvas.height = message.height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Could not create the recording canvas context");
  context.fillStyle = "black";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const stream = canvas.captureStream(message.frameRate);
  const mimeType = recorderMimeType();
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: message.videoBitsPerSecond,
  });
  const chunks = [];
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  });
  const stopped = new Promise((resolve, reject) => {
    recorder.addEventListener("stop", resolve, { once: true });
    recorder.addEventListener(
      "error",
      (event) => reject(event.error || new Error("MediaRecorder failed")),
      { once: true },
    );
  });
  recording = {
    id: message.id,
    canvas,
    chunks,
    context,
    frameCount: 0,
    mimeType,
    recorder,
    stopped,
    stream,
  };
  recorder.start(250);
  return { mimeType, width: canvas.width, height: canvas.height };
}

async function drawFrame(message) {
  const current = requireRecording(message.id);
  const response = await fetch(`data:image/jpeg;base64,${message.data}`);
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const scale = Math.min(
      current.canvas.width / bitmap.width,
      current.canvas.height / bitmap.height,
    );
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const x = Math.floor((current.canvas.width - width) / 2);
    const y = Math.floor((current.canvas.height - height) / 2);
    current.context.fillStyle = "black";
    current.context.fillRect(0, 0, current.canvas.width, current.canvas.height);
    current.context.drawImage(bitmap, x, y, width, height);
    current.frameCount += 1;
    return { frameCount: current.frameCount };
  } finally {
    bitmap.close();
  }
}

async function stop(message) {
  const current = requireRecording(message.id);
  current.recorder.stop();
  await current.stopped;
  for (const track of current.stream.getTracks()) track.stop();
  const blob = new Blob(current.chunks, { type: current.mimeType });
  const url = URL.createObjectURL(blob);
  recording = undefined;
  return {
    blobSize: blob.size,
    frameCount: current.frameCount,
    mimeType: current.mimeType,
    url,
  };
}

function revoke(message) {
  URL.revokeObjectURL(message.url);
  return { revoked: true };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== MESSAGE_TARGET) return false;
  const operation =
    message.type === "start"
      ? start(message)
      : message.type === "frame"
        ? drawFrame(message)
        : message.type === "stop"
          ? stop(message)
          : message.type === "revoke"
            ? Promise.resolve(revoke(message))
            : Promise.reject(
                new Error(`Unknown recording probe message: ${message.type}`),
              );
  void operation.then(
    (result) => sendResponse({ ok: true, result }),
    (error) =>
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
  );
  return true;
});
