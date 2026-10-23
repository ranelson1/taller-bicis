import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

// Almacenamiento de fotos de OT. Hoy: disco local (UPLOADS_DIR, por defecto ./uploads junto a la API).
// Para producción se puede cambiar por S3/R2 implementando estas mismas tres funciones.

const ROOT = path.resolve(process.env.UPLOADS_DIR || "uploads");

export const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

// Videos que el mecánico muestra al cliente (celular: mp4/mov; algunos navegadores: webm).
export const VIDEO_TYPES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};
export const MAX_VIDEO_BYTES = 60 * 1024 * 1024;

// Firma real del video: "ftyp" a partir del byte 4 (mp4/mov) o cabecera EBML (webm).
export function sniffVideoType(buf: Buffer): string | null {
  if (buf.length >= 12 && buf.subarray(4, 8).toString("ascii") === "ftyp") {
    return buf.subarray(8, 12).toString("ascii").startsWith("qt") ? "video/quicktime" : "video/mp4";
  }
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return "video/webm";
  return null;
}

// Revisa la firma real del archivo: no basta con el Content-Type que manda el navegador.
export function sniffImageType(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

// Extensión por tipo para todo lo que se guarda (imágenes y documentos de compra).
const EXTENSIONS: Record<string, string> = { ...ALLOWED_TYPES, ...VIDEO_TYPES, "application/pdf": "pdf", "application/xml": "xml" };

// La clave nunca viene del usuario: carpeta del taller + subcarpeta + nombre aleatorio.
export async function saveFile(workshopId: number, folder: string, data: Buffer, mimeType: string): Promise<string> {
  const key = `taller-${workshopId}/${folder}/${crypto.randomBytes(16).toString("hex")}.${EXTENSIONS[mimeType] ?? "bin"}`;
  const file = path.join(ROOT, key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data);
  return key;
}

export async function savePhoto(workshopId: number, workOrderId: number, data: Buffer, mimeType: string): Promise<string> {
  return saveFile(workshopId, `ot-${workOrderId}`, data, mimeType);
}

export async function readFile(key: string): Promise<Buffer> {
  return fs.readFile(photoPath(key));
}

export function photoPath(key: string): string {
  const file = path.resolve(ROOT, key);
  if (!file.startsWith(ROOT + path.sep)) throw new Error("Ruta de foto inválida");
  return file;
}

export async function deletePhotoFile(key: string): Promise<void> {
  await fs.rm(photoPath(key), { force: true });
}
