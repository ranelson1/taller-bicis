import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import type { buildPublicWorkOrder } from "./workOrderPublic";

// Comprobante en PDF de una orden de trabajo: lo mismo que ve el cliente en su link, en papel.
// Cotización mientras el trabajo está en curso; comprobante de servicio cuando la bici está lista o entregada.

type Ot = Awaited<ReturnType<typeof buildPublicWorkOrder>>;

const A4 = { w: 595.28, h: 841.89 };
const M = 42;                       // margen
const INK = rgb(0.13, 0.12, 0.11);
const MUTED = rgb(0.45, 0.43, 0.41);
const LINE = rgb(0.86, 0.84, 0.82);
const ACCENT = rgb(0.92, 0.35, 0.05);
const SOFT = rgb(0.97, 0.96, 0.95);
const GREEN = rgb(0.09, 0.5, 0.24);
const RED = rgb(0.75, 0.15, 0.15);

const clp = (n: number) => `$ ${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(Math.round(n))}`;
const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("es-CL", { day: "numeric", month: "long", year: "numeric" }) : null);

const BIKE_TYPES: Record<string, string> = { mtb: "MTB", road: "Ruta", gravel: "Gravel", urban: "Urbana", ebike: "E-Bike", kids: "Niños", other: "Otra" };

export type PdfLogo = { bytes: Uint8Array; kind: "jpg" | "png" } | null;

export async function renderWorkOrderPdf(ot: Ot, logo: PdfLogo, opts: { url?: string } = {}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Comprobante ${ot.workOrderNumber}`);
  pdf.setAuthor(ot.workshopName);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let logoImage: PDFImage | null = null;
  if (logo) {
    try { logoImage = logo.kind === "png" ? await pdf.embedPng(logo.bytes) : await pdf.embedJpg(logo.bytes); } catch { logoImage = null; }
  }

  // Helvetica solo trae caracteres latinos: lo demás se cambia por "?" en vez de romper el PDF.
  const supported = new Set(font.getCharacterSet());
  const clean = (s: string) => Array.from(s.replace(/\r/g, "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"'))
    .map(ch => (ch === "\n" || supported.has(ch.codePointAt(0)!) ? ch : "?")).join("");

  const wrap = (text: string, f: PDFFont, size: number, max: number): string[] => {
    const out: string[] = [];
    for (const para of clean(text).split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const test = line ? `${line} ${word}` : word;
        if (f.widthOfTextAtSize(test, size) <= max) { line = test; continue; }
        if (line) out.push(line);
        // palabra más larga que la línea: se corta
        let rest = word;
        while (f.widthOfTextAtSize(rest, size) > max) {
          let n = rest.length;
          while (n > 1 && f.widthOfTextAtSize(rest.slice(0, n), size) > max) n--;
          out.push(rest.slice(0, n));
          rest = rest.slice(n);
        }
        line = rest;
      }
      out.push(line);
    }
    return out;
  };

  let page: PDFPage = pdf.addPage([A4.w, A4.h]);
  let y = A4.h - M;
  const contentW = A4.w - M * 2;
  const bottom = M + 28;

  const text = (s: string, x: number, yy: number, o: { f?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; right?: number } = {}) => {
    const f = o.f ?? font; const size = o.size ?? 10;
    const t = clean(s);
    const px = o.right != null ? o.right - f.widthOfTextAtSize(t, size) : x;
    page.drawText(t, { x: px, y: yy, size, font: f, color: o.color ?? INK });
  };
  const rule = (yy: number, color = LINE) => page.drawLine({ start: { x: M, y: yy }, end: { x: A4.w - M, y: yy }, thickness: 0.7, color });
  const ensure = (needed: number, redraw?: () => void) => {
    if (y - needed >= bottom) return;
    page = pdf.addPage([A4.w, A4.h]);
    y = A4.h - M;
    redraw?.();
  };

  // ── Encabezado ──────────────────────────────────────────────────────────────
  const finished = ot.status === "ready_for_pickup" || ot.status === "delivered";
  const title = ot.status === "cancelled" ? "ORDEN CANCELADA" : finished ? "COMPROBANTE DE SERVICIO" : "COTIZACIÓN";
  let headX = M;
  if (logoImage) {
    const scale = Math.min(54 / logoImage.width, 54 / logoImage.height);
    const w = logoImage.width * scale, h = logoImage.height * scale;
    page.drawImage(logoImage, { x: M, y: y - h, width: w, height: h });
    headX = M + w + 12;
  }
  text(ot.workshopName, headX, y - 14, { f: bold, size: 16 });
  let hy = y - 28;
  for (const l of [ot.workshopPhone ? `Tel. ${ot.workshopPhone}` : null, ot.workshopAddress].filter(Boolean) as string[]) {
    text(l, headX, hy, { size: 9, color: MUTED });
    hy -= 12;
  }
  text(title, 0, y - 12, { f: bold, size: 12, color: ACCENT, right: A4.w - M });
  text(`Orden ${ot.workOrderNumber}`, 0, y - 28, { f: bold, size: 11, right: A4.w - M });
  text(`Emitido el ${day(new Date().toISOString())}`, 0, y - 42, { size: 9, color: MUTED, right: A4.w - M });
  y = Math.min(y - 66, hy - 6);
  rule(y);
  y -= 18;

  // ── Cliente y bicicleta ─────────────────────────────────────────────────────
  const bike = ot.bicycle
    ? [`${ot.bicycle.brand} ${ot.bicycle.model}`, ot.bicycle.type ? BIKE_TYPES[ot.bicycle.type] ?? ot.bicycle.type : null, ot.bicycle.year ? String(ot.bicycle.year) : null, ot.bicycle.color]
        .filter(Boolean).join(" · ")
    : "—";
  const cols: [string, string][] = [
    ["CLIENTE", ot.clientName || "—"],
    ["BICICLETA", bike],
    ["RECIBIDA", day(ot.receivedAt) ?? "—"],
    [ot.status === "delivered" ? "ENTREGADA" : finished ? "LISTA DESDE" : "ENTREGA ESTIMADA",
      (ot.status === "delivered" ? day(ot.deliveredAt) : finished ? day(ot.completedAt) : day(ot.estimatedDeliveryDate)) ?? "Por definir"],
  ];
  const half = contentW / 2;
  for (let i = 0; i < cols.length; i += 2) {
    const rowTop = y;
    let rowH = 0;
    for (let k = 0; k < 2 && cols[i + k]; k++) {
      const [label, value] = cols[i + k];
      const x = M + k * half;
      text(label, x, rowTop, { size: 7.5, f: bold, color: MUTED });
      const lines = wrap(value, font, 10.5, half - 14);
      lines.forEach((l, n) => text(l, x, rowTop - 13 - n * 13, { size: 10.5 }));
      rowH = Math.max(rowH, 13 + lines.length * 13);
    }
    y -= rowH + 8;
  }

  if (ot.reportedProblem) {
    text("PROBLEMA REPORTADO", M, y, { size: 7.5, f: bold, color: MUTED });
    const lines = wrap(ot.reportedProblem, font, 10, contentW);
    lines.forEach((l, n) => text(l, M, y - 13 - n * 12.5, { size: 10 }));
    y -= 13 + lines.length * 12.5 + 8;
  }

  // ── Detalle ─────────────────────────────────────────────────────────────────
  const colQty = A4.w - M - 190, colUnit = A4.w - M - 110, colTot = A4.w - M;
  const tableHead = () => {
    page.drawRectangle({ x: M, y: y - 16, width: contentW, height: 18, color: SOFT });
    text("DETALLE", M + 6, y - 10, { size: 7.5, f: bold, color: MUTED });
    text("CANT.", 0, y - 10, { size: 7.5, f: bold, color: MUTED, right: colQty + 20 });
    text("P. UNIT.", 0, y - 10, { size: 7.5, f: bold, color: MUTED, right: colUnit + 6 });
    text("TOTAL", 0, y - 10, { size: 7.5, f: bold, color: MUTED, right: colTot - 6 });
    y -= 26;
  };
  ensure(60);
  tableHead();

  const approved = ot.items.filter(i => i.approvalStatus === "approved" && i.status !== "cancelled");
  const pending = ot.items.filter(i => i.approvalStatus === "pending" && i.status !== "cancelled");
  for (const it of approved) {
    const isDiscount = it.itemType === "discount";
    const lines = wrap(it.description, font, 10, colQty - M - 40);
    const h = Math.max(lines.length * 12.5, 14) + 10;
    ensure(h + 4, tableHead);
    // La fila ocupa de `y` hacia abajo: texto en la parte alta y la línea al pie.
    const base = y - 11;
    lines.forEach((l, n) => text(l, M + 6, base - n * 12.5, { size: 10 }));
    text(String(Number.isInteger(it.quantity) ? it.quantity : it.quantity.toFixed(2)), 0, base, { size: 10, right: colQty + 20 });
    text(clp(it.unitPrice), 0, base, { size: 10, right: colUnit + 6, color: MUTED });
    text(`${isDiscount ? "- " : ""}${clp(it.total)}`, 0, base, { size: 10, f: bold, right: colTot - 6, color: isDiscount || it.total === 0 ? GREEN : INK });
    y -= h;
    page.drawLine({ start: { x: M, y }, end: { x: A4.w - M, y }, thickness: 0.4, color: LINE });
  }
  if (approved.length === 0) { text("Sin ítems aprobados todavía.", M + 6, y - 11, { size: 10, color: MUTED }); y -= 24; }

  // ── Totales ─────────────────────────────────────────────────────────────────
  y -= 12;
  const totalRow = (label: string, value: string, o: { strong?: boolean; color?: ReturnType<typeof rgb> } = {}) => {
    ensure(20);
    text(label, 0, y, { size: o.strong ? 11 : 9.5, f: o.strong ? bold : font, color: o.color ?? (o.strong ? INK : MUTED), right: colUnit + 6 });
    text(value, 0, y, { size: o.strong ? 12 : 9.5, f: o.strong ? bold : font, color: o.color ?? INK, right: colTot - 6 });
    y -= o.strong ? 20 : 15;
  };
  if (ot.discountTotal > 0) { totalRow("Subtotal", clp(ot.subtotal)); totalRow("Descuentos", `- ${clp(ot.discountTotal)}`, { color: GREEN }); }
  totalRow("Neto", clp(ot.net));
  totalRow("IVA (19%)", clp(ot.tax));
  y -= 10;
  page.drawRectangle({ x: A4.w - M - 210, y: y - 6, width: 210, height: 24, color: ACCENT });
  text("TOTAL", A4.w - M - 200, y + 2, { f: bold, size: 11, color: rgb(1, 1, 1) });
  text(clp(ot.total), 0, y + 1, { f: bold, size: 13, color: rgb(1, 1, 1), right: colTot - 6 });
  y -= 30;

  // Estado del pago
  const paid = ot.paidAt ? (ot.paidAmount ?? ot.total) : 0;
  const owed = Math.max(0, ot.total - paid);
  if (ot.status !== "cancelled" && ot.total > 0) {
    ensure(40);
    if (ot.paidAt && owed < 0.5) {
      text(`PAGADO el ${day(ot.paidAt)}`, 0, y, { f: bold, size: 11, color: GREEN, right: colTot });
      y -= 18;
    } else if (ot.paidAt) {
      text(`Abonado el ${day(ot.paidAt)}: ${clp(paid)}`, 0, y, { size: 10, color: MUTED, right: colTot });
      y -= 15;
      text(`SALDO POR PAGAR: ${clp(owed)}`, 0, y, { f: bold, size: 11, color: RED, right: colTot });
      y -= 18;
    } else if (finished) {
      text(`POR PAGAR: ${clp(owed)}`, 0, y, { f: bold, size: 11, color: RED, right: colTot });
      y -= 18;
    }
  }

  const block = (heading: string, body: string, boxed = false) => {
    const lines = wrap(body, font, 10, contentW - (boxed ? 20 : 0));
    const h = 18 + lines.length * 12.5 + (boxed ? 14 : 4);
    ensure(h + 8);
    y -= 6;
    if (boxed) page.drawRectangle({ x: M, y: y - h + 12, width: contentW, height: h, color: SOFT });
    const x = M + (boxed ? 10 : 0);
    text(heading, x, y - (boxed ? 4 : 0), { size: 7.5, f: bold, color: MUTED });
    lines.forEach((l, n) => text(l, x, y - 17 - n * 12.5 + (boxed ? -2 : 0), { size: 10 }));
    y -= h;
  };

  if (ot.paymentInfo && owed > 0.5) block("DATOS PARA TRANSFERIR", ot.paymentInfo, true);

  if (pending.length > 0) {
    block("PENDIENTES DE TU APROBACIÓN (NO INCLUIDOS EN EL TOTAL)",
      pending.map(p => `- ${p.description}: ${clp(p.total)}`).join("\n"));
  }
  if (ot.bicycle?.setupNotes) {
    block("AJUSTES DE LA BICICLETA", ot.bicycle.setupNotes, true);
  }
  if (ot.customerNotes) block("NOTAS", ot.customerNotes);

  // ── Pie de página en todas las hojas ───────────────────────────────────────
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const footer = `${ot.workshopName}${opts.url ? ` · ${opts.url}` : ""}`;
    p.drawLine({ start: { x: M, y: M + 14 }, end: { x: A4.w - M, y: M + 14 }, thickness: 0.5, color: LINE });
    p.drawText(clean(footer).slice(0, 110), { x: M, y: M, size: 8, font, color: MUTED });
    const label = `Página ${i + 1} de ${pages.length}`;
    p.drawText(label, { x: A4.w - M - font.widthOfTextAtSize(label, 8), y: M, size: 8, font, color: MUTED });
  });

  return pdf.save();
}
