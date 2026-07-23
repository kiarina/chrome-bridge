const MIN_DOWNLOAD_TIMEOUT_SECONDS = 0.1;
const MAX_DOWNLOAD_TIMEOUT_SECONDS = 60;

function errorDetail(error) {
  return error instanceof Error ? error.message : String(error);
}

export function validateDownloadTimeout(timeout) {
  if (
    typeof timeout !== "number" ||
    !Number.isFinite(timeout) ||
    timeout < MIN_DOWNLOAD_TIMEOUT_SECONDS ||
    timeout > MAX_DOWNLOAD_TIMEOUT_SECONDS
  ) {
    throw new Error(
      `timeout must be between ${MIN_DOWNLOAD_TIMEOUT_SECONDS} and ${MAX_DOWNLOAD_TIMEOUT_SECONDS} seconds`,
    );
  }
  return timeout;
}

export function observeTargetDownload(
  debuggee,
  timeoutSeconds,
  { debuggerApi = chrome.debugger } = {},
) {
  const timeoutMs = validateDownloadTimeout(timeoutSeconds) * 1_000;
  let started = false;
  let settled = false;
  let guid;
  let suggestedFilename;
  let timeout;
  let resolvePromise;
  let rejectPromise;

  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  const finish = (error, result) => {
    if (settled) return;
    settled = true;
    if (timeout !== undefined) clearTimeout(timeout);
    if (error) rejectPromise(error);
    else resolvePromise(result);
  };

  const onEvent = (source, method, params) => {
    if (!started || source.targetId !== debuggee.targetId) return;
    if (method === "Page.downloadWillBegin") {
      if (
        typeof params?.guid !== "string" ||
        !params.guid ||
        typeof params?.suggestedFilename !== "string" ||
        !params.suggestedFilename
      ) {
        finish(new Error("Chrome returned invalid download start metadata"));
        return;
      }
      if (guid && guid !== params.guid) {
        finish(new Error("The referenced click started multiple downloads"));
        return;
      }
      guid = params.guid;
      suggestedFilename = params.suggestedFilename;
      return;
    }
    if (method !== "Page.downloadProgress" || !guid || params?.guid !== guid)
      return;
    if (params.state === "canceled") {
      finish(new Error("The target download was canceled or interrupted"));
      return;
    }
    if (params.state !== "completed") return;
    const receivedBytes = params.receivedBytes;
    const totalBytes = params.totalBytes;
    if (
      typeof receivedBytes !== "number" ||
      !Number.isFinite(receivedBytes) ||
      receivedBytes < 0 ||
      typeof totalBytes !== "number" ||
      !Number.isFinite(totalBytes) ||
      totalBytes < 0
    ) {
      finish(new Error("Chrome returned invalid download completion metadata"));
      return;
    }
    finish(undefined, {
      suggestedFilename,
      state: "complete",
      receivedBytes,
      totalBytes,
    });
  };

  const onDetach = (source, reason) => {
    if (!started || source.targetId !== debuggee.targetId) return;
    finish(
      new Error(
        `Chrome debugger detached while waiting for the target download: ${reason || "unknown"}`,
      ),
    );
  };

  debuggerApi.onEvent.addListener(onEvent);
  debuggerApi.onDetach.addListener(onDetach);
  return {
    promise,
    start() {
      if (started) throw new Error("Download observation already started");
      started = true;
      timeout = setTimeout(
        () =>
          finish(
            new Error(
              `The target download did not complete within ${timeoutSeconds} seconds`,
            ),
          ),
        timeoutMs,
      );
    },
    cleanup() {
      if (timeout !== undefined) clearTimeout(timeout);
      debuggerApi.onEvent.removeListener(onEvent);
      debuggerApi.onDetach.removeListener(onDetach);
      settled = true;
    },
    errorDetail,
  };
}
