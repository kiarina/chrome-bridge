import { loadBrowserIdentity } from "./identity.js";
import { DEFAULT_SERVER_URL } from "./runtime-config.js";

const form = document.querySelector("#settings-form");
const serverUrl = document.querySelector("#server-url");
const browserLabel = document.querySelector("#browser-label");
const browserId = document.querySelector("#browser-id");
const message = document.querySelector("#message");

const identity = await loadBrowserIdentity(chrome.storage.local);
const stored = await chrome.storage.local.get(["serverUrl"]);
serverUrl.value = stored.serverUrl || DEFAULT_SERVER_URL;
browserId.value = identity.browserId;
browserLabel.value = identity.browserLabel;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const parsedUrl = new URL(serverUrl.value);
  if (!(["ws:", "wss:"].includes(parsedUrl.protocol))) {
    message.textContent = "URL must use ws:// or wss://.";
    return;
  }
  const label = browserLabel.value.trim();
  if (!label || label.length > 64) {
    message.textContent = "Browser label must be 1–64 characters.";
    return;
  }
  await chrome.storage.local.set({
    serverUrl: parsedUrl.toString(),
    browserLabel: label,
  });
  message.textContent = "Saved. The extension is reconnecting.";
});
