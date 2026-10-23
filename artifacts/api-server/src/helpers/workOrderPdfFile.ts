import { db, workshopSettingsTable, workOrdersTable } from "@workspace/db";
import { readFile, sniffImageType } from "./photoStorage";
import { buildPublicWorkOrder } from "./workOrderPublic";
import { renderWorkOrderPdf, type PdfLogo } from "./workOrderPdf";

// PDF del comprobante de una OT del taller actual (el request ya está fijado a su taller).
export async function buildWorkOrderPdf(wo: typeof workOrdersTable.$inferSelect, publicUrl?: string): Promise<{ bytes: Uint8Array; fileName: string }> {
  const ot = await buildPublicWorkOrder(wo);
  let logo: PdfLogo = null;
  try {
    const [row] = await db.select({ key: workshopSettingsTable.logoKey }).from(workshopSettingsTable);
    if (row?.key) {
      const bytes = await readFile(row.key);
      const mime = sniffImageType(bytes);
      if (mime === "image/png") logo = { bytes, kind: "png" };
      else if (mime === "image/jpeg") logo = { bytes, kind: "jpg" };
    }
  } catch {
    logo = null; // sin logo el comprobante sale igual
  }
  const bytes = await renderWorkOrderPdf(ot, logo, { url: publicUrl });
  return { bytes, fileName: `Comprobante-${ot.workOrderNumber}.pdf` };
}

export function sendPdf(res: import("express").Response, file: { bytes: Uint8Array; fileName: string }) {
  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${file.fileName}"`,
    "Cache-Control": "private, no-store",
  });
  res.send(Buffer.from(file.bytes));
}
