const MESSAGE_TARGET = "chrome-bridge-recording-offscreen";
const MIME_TYPES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

let recording;
const objectUrls = new Set();

function requireRecording(id) {
  if (!recording || recording.id !== id) {
    throw new Error(`Recording ${id} is not active`);
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

async function disposeCurrent() {
  const current = recording;
  recording = undefined;
  if (!current) return;
  if (current.recorder && current.recorder.state !== "inactive") {
    current.recorder.stop();
    try {
      await current.stopped;
    } catch {
      // Abort intentionally discards encoder errors with the partial recording.
    }
  }
  for (const track of current.stream?.getTracks() || []) track.stop();
}

async function reset() {
  await disposeCurrent();
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls.clear();
  return { reset: true };
}

async function start(message) {
  if (recording) throw new Error("Another recording is active");
  if (
    !Number.isInteger(message.width) ||
    message.width <= 0 ||
    !Number.isInteger(message.height) ||
    message.height <= 0
  ) {
    throw new Error("Recording dimensions are invalid");
  }
  const canvas = document.createElement("canvas");
  canvas.width = message.width;
  canvas.height = message.height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Could not create the recording canvas context");
  context.fillStyle = "black";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const mimeType = recorderMimeType();
  recording = {
    id: message.id,
    canvas,
    chunks: [],
    context,
    frameCount: 0,
    frameRate: message.frameRate,
    mimeType,
    recorder: undefined,
    stopped: undefined,
    stream: undefined,
    videoBitsPerSecond: message.videoBitsPerSecond,
  };
  return { mimeType, width: canvas.width, height: canvas.height };
}

function startEncoder(current) {
  // Creating the stream before the first draw makes MediaRecorder encode the canvas's
  // black initialization. Start only after drawFrame has painted the real target.
  const stream = current.canvas.captureStream(current.frameRate);
  current.stream = stream;
  const recorder = new MediaRecorder(stream, {
    mimeType: current.mimeType,
    videoBitsPerSecond: current.videoBitsPerSecond,
  });
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) current.chunks.push(event.data);
  });
  const stopped = new Promise((resolve, reject) => {
    recorder.addEventListener("stop", resolve, { once: true });
    recorder.addEventListener(
      "error",
      (event) => reject(event.error || new Error("MediaRecorder failed")),
      { once: true },
    );
  });
  current.recorder = recorder;
  current.stopped = stopped;
  recorder.start(250);
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
    if (!current.recorder) startEncoder(current);
    current.frameCount += 1;
    return { frameCount: current.frameCount };
  } finally {
    bitmap.close();
  }
}

async function stop(message) {
  const current = requireRecording(message.id);
  if (!current.recorder) {
    throw new Error("Recording has no submitted frames");
  }
  current.recorder.stop();
  await current.stopped;
  for (const track of current.stream.getTracks()) track.stop();
  const blob = new Blob(current.chunks, { type: current.mimeType });
  const url = URL.createObjectURL(blob);
  objectUrls.add(url);
  recording = undefined;
  return {
    blobSize: blob.size,
    frameCount: current.frameCount,
    mimeType: current.mimeType,
    url,
  };
}

async function abort(message) {
  if (!recording || recording.id !== message.id) return { aborted: false };
  await disposeCurrent();
  return { aborted: true };
}

function revoke(message) {
  if (objectUrls.delete(message.url)) URL.revokeObjectURL(message.url);
  return { revoked: true };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== MESSAGE_TARGET) return false;
  const operation =
    message.type === "reset"
      ? reset()
      : message.type === "start"
        ? start(message)
        : message.type === "frame"
          ? drawFrame(message)
          : message.type === "stop"
            ? stop(message)
            : message.type === "abort"
              ? abort(message)
              : message.type === "revoke"
                ? Promise.resolve(revoke(message))
                : Promise.reject(
                    new Error(`Unknown recording message: ${message.type}`),
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
