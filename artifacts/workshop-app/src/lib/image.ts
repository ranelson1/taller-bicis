// Reduce una imagen en el navegador antes de subirla: las del celular pesan 3–8 MB y
// para respaldo basta con ~1600 px. Respeta la orientación de la cámara (EXIF).

type Options = { maxSide?: number; type?: "image/jpeg" | "image/png"; quality?: number };

export async function resizeImage(file: File, { maxSide = 1600, type = "image/jpeg", quality = 0.82 }: Options = {}): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
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
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error("No se pudo procesar la imagen"))), type, quality));
}

// Logos: PNG (mantiene la transparencia) y chico, se muestra a lo más a 64 px.
export const resizeLogo = (file: File) => resizeImage(file, { maxSide: 512, type: "image/png" });
