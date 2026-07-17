export const LANDSCAPE_MAX_WIDTH = 1_920;
export const LANDSCAPE_MAX_HEIGHT = 1_080;
export const PORTRAIT_MAX_WIDTH = 1_080;
export const PORTRAIT_MAX_HEIGHT = 1_920;

export function fitWithinMediaBounds(sourceWidth, sourceHeight) {
  if (!Number.isFinite(sourceWidth) || sourceWidth <= 0) {
    throw new Error("sourceWidth must be positive");
  }
  if (!Number.isFinite(sourceHeight) || sourceHeight <= 0) {
    throw new Error("sourceHeight must be positive");
  }
  const landscapeOrSquare = sourceWidth >= sourceHeight;
  const maxWidth = landscapeOrSquare
    ? LANDSCAPE_MAX_WIDTH
    : PORTRAIT_MAX_WIDTH;
  const maxHeight = landscapeOrSquare
    ? LANDSCAPE_MAX_HEIGHT
    : PORTRAIT_MAX_HEIGHT;
  const scale = Math.min(
    1,
    maxWidth / sourceWidth,
    maxHeight / sourceHeight,
  );
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
    scale,
    maxWidth,
    maxHeight,
  };
}
