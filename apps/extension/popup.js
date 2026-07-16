const status = document.querySelector("#status");
const detail = document.querySelector("#detail");
const identity = document.querySelector("#identity");
const target = document.querySelector("#target");
const { connectionStatus, browserId, browserLabel } =
  await chrome.storage.local.get([
    "connectionStatus",
    "browserId",
    "browserLabel",
  ]);
status.textContent = connectionStatus?.status || "not configured";
detail.textContent =
  connectionStatus?.detail || "Start the local chrome-bridge server.";
identity.textContent = browserId
  ? `Browser: ${browserLabel || "Unlabeled"} (${browserId})`
  : "Browser identity is initializing.";
async function renderTarget() {
  const { targetTabId, operatingTabId } = await chrome.storage.session.get([
    "targetTabId",
    "operatingTabId",
  ]);
  delete target.dataset.state;
  if (!Number.isInteger(targetTabId)) {
    target.textContent = "Target: not selected";
    return;
  }
  try {
    const tab = await chrome.tabs.get(targetTabId);
    const state = operatingTabId === targetTabId ? "Operating" : "Target";
    target.dataset.state = state.toLowerCase();
    target.textContent = `${state}: ${tab.title || tab.url || `Tab ${targetTabId}`} (${targetTabId})`;
  } catch {
    await chrome.storage.session.remove([
      "targetTabId",
      "operatingTabId",
      "operatingToken",
    ]);
    target.textContent = "Target: not selected";
  }
}

await renderTarget();
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (
    areaName === "session" &&
    (changes.targetTabId || changes.operatingTabId)
  ) {
    void renderTarget();
  }
});
document.querySelector("#open-options").addEventListener("click", () => {
  void chrome.runtime.openOptionsPage();
});
