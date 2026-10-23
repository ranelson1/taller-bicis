import { resizeImage } from "@/lib/image";

// Subida de fotos y videos de una OT desde el celular: las fotos se reducen en el teléfono (3–8 MB → ~300 KB)
// y los videos se mandan tal cual, con progreso y un reintento si se cae la conexión.

export const MAX_VIDEO_MB = 100;

export const isVideoFile = (f: File) => f.type.startsWith("video/") || /\.(mp4|mov|m4v|webm)$/i.test(f.name);
export const isImageFile = (f: File) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name);
export const isMediaFile = (f: File) => isImageFile(f) || isVideoFile(f);

// Algunos Android no informan el tipo del video: se deduce por la extensión.
function videoType(f: File): string {
  if (f.type.startsWith("video/")) return f.type === "video/x-m4v" ? "video/mp4" : f.type;
  return /\.mov$/i.test(f.name) ? "video/quicktime" : /\.webm$/i.test(f.name) ? "video/webm" : "video/mp4";
}

function send(url: string, blob: Blob, type: string, onProgress?: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Content-Type", type);
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) { onProgress?.(100); resolve(); return; }
      let message = "No se pudo subir el archivo";
      try { message = JSON.parse(xhr.responseText)?.error ?? message; } catch { /* sin cuerpo */ }
      // Los errores del servidor (archivo inválido, muy pesado) no se reintentan.
      reject(Object.assign(new Error(message), { retry: false }));
    };
    xhr.onerror = () => reject(Object.assign(new Error("Sin conexión: revisa tu internet y vuelve a intentar"), { retry: true }));
    xhr.ontimeout = xhr.onerror;
    xhr.send(blob);
  });
}

export async function uploadWorkOrderMedia(
  workOrderId: number, file: File, opts: { note?: string; onProgress?: (pct: number) => void } = {},
): Promise<void> {
  const video = isVideoFile(file);
  if (video && file.size > MAX_VIDEO_MB * 1024 * 1024) {
    throw new Error(`El video pesa ${Math.round(file.size / 1048576)} MB (máximo ${MAX_VIDEO_MB} MB). Graba uno más corto o en calidad 1080p.`);
  }
  const blob = video ? file : await resizeImage(file);
  const type = video ? videoType(file) : "image/jpeg";
  const url = `/api/work-orders/${workOrderId}/photos${opts.note ? `?note=${encodeURIComponent(opts.note)}` : ""}`;
  try {
    await send(url, blob, type, opts.onProgress);
  } catch (e: any) {
    if (!e?.retry) throw e;
    opts.onProgress?.(0);
    await send(url, blob, type, opts.onProgress); // un reintento por si fue un corte momentáneo
  }
}
