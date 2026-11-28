/** The pixel size of an image file (an SVG without a size falls back to 200×200). */
export async function naturalSize(file: Blob): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image.naturalWidth && image.naturalHeight
      ? { width: image.naturalWidth, height: image.naturalHeight } : { width: 200, height: 200 };
  } catch {
    return { width: 200, height: 200 };
  } finally {
    URL.revokeObjectURL(url);
  }
}
