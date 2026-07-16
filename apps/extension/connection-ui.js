const CONNECTED_ICONS = Object.freeze({
  16: "icons/icon-16.png",
  32: "icons/icon-32.png",
});

const DISCONNECTED_ICONS = Object.freeze({
  16: "icons/disconnected/icon-16.png",
  32: "icons/disconnected/icon-32.png",
});

const STATUS_LABELS = Object.freeze({
  connected: "Connected",
  connecting: "Connecting",
  disconnected: "Disconnected",
  error: "Connection error",
});

export function connectionActionPresentation(status) {
  const connected = status === "connected";
  return {
    iconPath: connected ? CONNECTED_ICONS : DISCONNECTED_ICONS,
    title: `Chrome Bridge — ${STATUS_LABELS[status] || "Disconnected"}`,
  };
}
