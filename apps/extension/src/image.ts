export type ResizedPng = {
  data: string;
  width: number;
  height: number;
};

export async function resizePng(
  data: string,
  maxWidth: number,
  maxHeight: number,
): Promise<ResizedPng> {
  if (!data) throw new Error("PNG data is required");
  if (!Number.isFinite(maxWidth) || maxWidth <= 0) {
    throw new Error("maxWidth must be positive");
  }
  if (!Number.isFinite(maxHeight) || maxHeight <= 0) {
    throw new Error("maxHeight must be positive");
  }

  const response = await fetch(`data:image/png;base64,${data}`);
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const scale = Math.min(
      1,
      maxWidth / bitmap.width,
      maxHeight / bitmap.height,
    );
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not create a canvas context");
    context.drawImage(bitmap, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/png");
    const prefix = "data:image/png;base64,";
    if (!dataUrl.startsWith(prefix)) {
      throw new Error("Canvas returned an invalid PNG data URL");
    }
    return { data: dataUrl.slice(prefix.length), width, height };
  } finally {
    bitmap.close();
  }
}
