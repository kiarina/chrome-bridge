const BROWSER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const BROWSER_ID_KEY = "browserId";
export const BROWSER_LABEL_KEY = "browserLabel";

export async function loadBrowserIdentity(
  storageArea,
  createId = () => crypto.randomUUID(),
) {
  const stored = await storageArea.get([BROWSER_ID_KEY, BROWSER_LABEL_KEY]);
  const browserId = BROWSER_ID_PATTERN.test(stored[BROWSER_ID_KEY])
    ? stored[BROWSER_ID_KEY]
    : createId();
  const storedLabel =
    typeof stored[BROWSER_LABEL_KEY] === "string"
      ? stored[BROWSER_LABEL_KEY].trim()
      : "";
  const browserLabel =
    storedLabel && storedLabel.length <= 64
      ? storedLabel
      : `Browser ${browserId.slice(0, 8)}`;
  if (
    stored[BROWSER_ID_KEY] !== browserId ||
    stored[BROWSER_LABEL_KEY] !== browserLabel
  ) {
    await storageArea.set({ browserId, browserLabel });
  }
  return { browserId, browserLabel };
}

export function shouldReconnectForIdentityChange(changes, areaName) {
  return Boolean(
    areaName === "local" &&
      changes[BROWSER_LABEL_KEY] &&
      changes[BROWSER_LABEL_KEY].oldValue !== undefined,
  );
}
