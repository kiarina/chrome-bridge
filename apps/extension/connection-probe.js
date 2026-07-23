const DEFAULT_PROBE_TIMEOUT_MS = 1_000;

export function healthUrlForServer(serverUrl) {
  const url = new URL(serverUrl);
  if (url.protocol === "ws:") url.protocol = "http:";
  else if (url.protocol === "wss:") url.protocol = "https:";
  else throw new Error("Extension server URL must use ws:// or wss://");
  url.pathname = "/health";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export async function serverIsReachable(
  serverUrl,
  {
    fetchApi = globalThis.fetch,
    timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
  } = {},
) {
  const controller = new globalThis.AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchApi(healthUrlForServer(serverUrl), {
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const body = await response.json();
    return body?.status === "ok";
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
