// Reduce una foto en el navegador antes de subirla: las del celular pesan 3–8 MB y
// para respaldo basta con ~1600 px. Respeta la orientación de la cámara (EXIF).

const MAX_SIDE = 1600;
const QUALITY = 0.82;

export async function resizeImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo procesar la imagen");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error("No se pudo procesar la imagen"))), "image/jpeg", QUALITY));
}
