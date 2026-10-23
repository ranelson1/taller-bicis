import Anthropic from "@anthropic-ai/sdk";
import { XMLParser } from "fast-xml-parser";
import { z } from "zod/v4";

// Lee facturas, boletas y guías de compra para ingresarlas al inventario.
//  - XML del SII (DTE): lectura directa, exacta y gratis.
//  - PDF o foto: Claude lee el documento y devuelve los datos en un formato fijo (JSON schema).
// En ambos casos el resultado es un borrador que el taller revisa antes de confirmar.

export type ParsedInvoice = {
  docType: "factura" | "boleta" | "guia" | "otro";
  docNumber: string | null;
  issuedOn: string | null;              // YYYY-MM-DD
  supplierName: string | null;
  supplierRut: string | null;
  netTotal: number | null;
  taxTotal: number | null;
  total: number | null;
  lines: { description: string; supplierCode: string | null; quantity: number; unit: string | null; unitCostNet: number }[];
};

export class InvoiceReadError extends Error {}

const VAT = 0.19;
const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => (v == null || v === "" ? null : Number(String(v).replace(",", ".")));
const asArray = <T>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

// ── XML del SII ────────────────────────────────────────────────────────────────
// Tipos de DTE: 33 factura, 34 factura exenta, 39 boleta, 41 boleta exenta, 46 factura de compra, 52 guía.
const DTE_TYPES: Record<string, ParsedInvoice["docType"]> = {
  "33": "factura", "34": "factura", "46": "factura", "39": "boleta", "41": "boleta", "52": "guia",
};
const EXEMPT = new Set(["34", "41"]);

export function readDteXml(xml: Buffer): ParsedInvoice {
  const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false, trimValues: true });
  let tree: any;
  try {
    tree = parser.parse(xml.toString("latin1").includes("encoding=\"ISO-8859-1\"") ? xml.toString("latin1") : xml.toString("utf8"));
  } catch {
    throw new InvoiceReadError("El XML no se pudo leer");
  }
  // El documento puede venir suelto (DTE) o dentro de un envío (EnvioDTE > SetDTE > DTE).
  const dte = tree?.DTE ?? asArray(tree?.EnvioDTE?.SetDTE?.DTE)[0] ?? asArray(tree?.EnvioBOLETA?.SetDTE?.DTE)[0];
  const doc = dte?.Documento ?? dte?.Exportaciones ?? dte?.Liquidacion;
  const enc = doc?.Encabezado;
  if (!enc?.IdDoc) {
    const generic = readGenericXml(tree);
    if (generic) return generic;
    throw new InvoiceReadError("No pude reconocer este XML. Sube el XML del SII, o el PDF o una foto de la factura");
  }

  const tipo = String(enc.IdDoc.TipoDTE ?? "");
  const exempt = EXEMPT.has(tipo);
  // Boletas: precios con IVA (MntBruto=1 lo indica también en facturas).
  const grossPrices = tipo === "39" || String(enc.IdDoc.MntBruto ?? "") === "1";
  const emisor = enc.Emisor ?? {};
  const totales = enc.Totales ?? {};

  const lines = asArray<any>(doc.Detalle).map((d) => {
    const qty = num(d.QtyItem) ?? 1;
    const lineTotal = num(d.MontoItem);
    const price = num(d.PrcItem) ?? (lineTotal != null ? lineTotal / qty : 0);
    // El monto de la línea ya trae descuentos; se prefiere a precio × cantidad.
    let unit = lineTotal != null && qty > 0 ? lineTotal / qty : price;
    if (grossPrices && !exempt) unit = unit / (1 + VAT);
    const code = asArray<any>(d.CdgItem)[0]?.VlrCodigo;
    return {
      description: String(d.NmbItem ?? d.DscItem ?? "Ítem").trim(),
      supplierCode: code != null ? String(code).trim() : null,
      quantity: qty,
      unit: d.UnmdItem ? String(d.UnmdItem).trim().toLowerCase() : null,
      unitCostNet: round2(unit),
    };
  });
  if (lines.length === 0) throw new InvoiceReadError("El documento no tiene líneas de detalle");

  const total = num(totales.MntTotal);
  const net = num(totales.MntNeto) ?? (exempt ? num(totales.MntExe) ?? total : total != null ? round2(total / (1 + VAT)) : null);
  return {
    docType: DTE_TYPES[tipo] ?? "otro",
    docNumber: enc.IdDoc.Folio != null ? String(enc.IdDoc.Folio) : null,
    issuedOn: enc.IdDoc.FchEmis ? String(enc.IdDoc.FchEmis).slice(0, 10) : null,
    supplierName: emisor.RznSoc ?? emisor.RznSocEmisor ?? null,
    supplierRut: emisor.RUTEmisor ?? null,
    netTotal: net,
    taxTotal: num(totales.IVA) ?? (exempt ? 0 : null),
    total,
    lines,
  };
}

// ── XML que no es del SII (formatos de proveedores o de otros sistemas) ───────────
// Se busca por nombres de etiqueta habituales: emisor, totales y una o más líneas de detalle.
const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");
function pick(obj: any, names: string[]): any {
  if (obj == null || typeof obj !== "object") return undefined;
  const wanted = new Set(names.map(norm));
  for (const [k, v] of Object.entries(obj)) if (wanted.has(norm(k)) && v != null && typeof v !== "object") return v;
  return undefined;
}
function findKey(obj: any, names: string[], depth = 0): any {
  if (obj == null || typeof obj !== "object" || depth > 5) return undefined;
  const wanted = new Set(names.map(norm));
  for (const [k, v] of Object.entries(obj)) if (wanted.has(norm(k))) return v;
  for (const v of Object.values(obj)) {
    const r = findKey(Array.isArray(v) ? v[0] : v, names, depth + 1);
    if (r !== undefined) return r;
  }
  return undefined;
}

function readGenericXml(tree: any): ParsedInvoice | null {
  const detail = asArray<any>(findKey(tree, ["Detalle", "Detalles", "Items", "Item", "Lineas", "Linea"]));
  const rawLines = detail.flatMap((d: any) => (d && typeof d === "object" && Object.keys(d).length === 1 && typeof Object.values(d)[0] === "object" ? asArray<any>(Object.values(d)[0]) : [d]));
  const lines = rawLines.filter((d: any) => d && typeof d === "object").map((d: any) => {
    const product = d.Producto ?? d.Product ?? d.Articulo ?? {};
    const description = pick(d, ["NmbItem", "Nombre", "Descripcion", "Detalle", "Glosa"]) ?? pick(product, ["Nombre", "Descripcion", "Name"]);
    const code = pick(d, ["Codigo", "Sku", "VlrCodigo"]) ?? pick(product, ["Codigo", "Sku", "Code"]);
    const qty = num(pick(d, ["Cantidad", "QtyItem", "Qty"])) ?? 1;
    const lineTotal = num(pick(d, ["MontoItem", "Monto", "Total", "Subtotal"]));
    const price = num(pick(d, ["PrecioUnitario", "PrcItem", "Precio", "ValorUnitario"]));
    const unit = price ?? (lineTotal != null && qty > 0 ? lineTotal / qty : 0);
    return {
      description: String(description ?? "Ítem").trim(),
      supplierCode: code != null ? String(code).trim() : null,
      quantity: qty,
      unit: null as string | null,
      unitCostNet: round2(unit),
    };
  }).filter((l) => l.description && l.unitCostNet >= 0);
  if (lines.length === 0) return null;

  const emisor = findKey(tree, ["Emisor", "Proveedor", "Vendedor"]) ?? {};
  const totales = findKey(tree, ["Totales", "Total", "Resumen"]);
  const t = totales && typeof totales === "object" ? totales : tree;
  const total = num(pick(t, ["MntTotal", "Total", "TotalConIVA"]) ?? findKey(tree, ["MntTotal"]));
  const net = num(pick(t, ["MntNeto", "Neto", "Subtotal"]));
  const iva = num(pick(t, ["IVA", "Impuesto"]));
  const rawType = String(findKey(tree, ["TipoDTE", "TipoDocumento", "Tipo"]) ?? "");
  return {
    docType: /boleta/i.test(JSON.stringify(Object.keys(tree ?? {}))) ? "boleta" : DTE_TYPES[rawType] ?? "factura",
    docNumber: (() => { const f = findKey(tree, ["Folio", "Numero", "NroDocumento"]); return f != null && typeof f !== "object" ? String(f) : null; })(),
    issuedOn: (() => { const f = findKey(tree, ["FchEmis", "Fecha", "FechaEmision"]); return f != null && typeof f !== "object" ? String(f).slice(0, 10) : null; })(),
    supplierName: pick(emisor, ["RznSoc", "RazonSocial", "Nombre"]) ?? null,
    supplierRut: pick(emisor, ["RUTEmisor", "RUT", "Rut"]) ?? null,
    netTotal: net ?? (total != null ? round2(total / (1 + VAT)) : null),
    taxTotal: iva,
    total,
    lines,
  };
}

// ── PDF o foto, leídos por Claude ─────────────────────────────────────────────
const MODEL = "claude-opus-5-5";

const invoiceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["isPurchaseDocument", "docType", "docNumber", "issuedOn", "supplierName", "supplierRut", "pricesIncludeVat", "netTotal", "taxTotal", "total", "lines"],
  properties: {
    isPurchaseDocument: { type: "boolean", description: "false si la imagen no es una factura, boleta o guía de compra" },
    docType: { type: "string", enum: ["factura", "boleta", "guia", "otro"] },
    docNumber: { type: ["string", "null"], description: "Folio o número del documento" },
    issuedOn: { type: ["string", "null"], description: "Fecha de emisión en formato YYYY-MM-DD" },
    supplierName: { type: ["string", "null"], description: "Razón social o nombre del emisor (el proveedor)" },
    supplierRut: { type: ["string", "null"], description: "RUT del emisor, con guion y dígito verificador" },
    pricesIncludeVat: { type: "boolean", description: "true si los precios unitarios de las líneas incluyen IVA (típico en boletas)" },
    netTotal: { type: ["number", "null"] },
    taxTotal: { type: ["number", "null"], description: "IVA del documento" },
    total: { type: ["number", "null"] },
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description", "code", "quantity", "unit", "unitPrice", "lineTotal"],
        properties: {
          description: { type: "string", description: "Descripción del producto tal como aparece" },
          code: { type: ["string", "null"], description: "Código o SKU del proveedor, si aparece" },
          quantity: { type: "number" },
          unit: { type: ["string", "null"], description: "Unidad de medida (un, lt, ml, kg, m…), si aparece" },
          unitPrice: { type: "number", description: "Precio unitario tal como aparece en el documento" },
          lineTotal: { type: ["number", "null"], description: "Total de la línea con descuentos, si aparece" },
        },
      },
    },
  },
} as const;

const claudeResult = z.object({
  isPurchaseDocument: z.boolean(),
  docType: z.enum(["factura", "boleta", "guia", "otro"]),
  docNumber: z.string().nullable(),
  issuedOn: z.string().nullable(),
  supplierName: z.string().nullable(),
  supplierRut: z.string().nullable(),
  pricesIncludeVat: z.boolean(),
  netTotal: z.number().nullable(),
  taxTotal: z.number().nullable(),
  total: z.number().nullable(),
  lines: z.array(z.object({
    description: z.string(),
    code: z.string().nullable(),
    quantity: z.number(),
    unit: z.string().nullable(),
    unitPrice: z.number(),
    lineTotal: z.number().nullable(),
  })),
});

const SYSTEM = `Extraes los datos de documentos de compra chilenos (facturas, boletas, guías de despacho) de proveedores de un taller de bicicletas.
Copia los valores tal como aparecen; no inventes datos: si algo no se ve o no está, usa null.
Montos en pesos chilenos como números sin separadores de miles (15.990 → 15990).
Una línea por producto del detalle; no incluyas como línea los totales, el IVA, descuentos globales ni el despacho salvo que aparezca como ítem cobrado.`;

export const claudeReaderAvailable = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

export async function readWithClaude(file: Buffer, mimeType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp"): Promise<ParsedInvoice> {
  if (!claudeReaderAvailable()) {
    throw new InvoiceReadError("La lectura de PDF y fotos no está configurada (falta ANTHROPIC_API_KEY). Sube el XML o ingresa la compra a mano.");
  }
  const client = new Anthropic();
  const data = file.toString("base64");
  const source: Anthropic.Beta.BetaContentBlockParam = mimeType === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
    : { type: "image", source: { type: "base64", media_type: mimeType, data } };

  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      // Si los filtros de seguridad rechazan el pedido, el servidor lo reintenta con el modelo recomendado.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      output_config: { effort: "medium", format: { type: "json_schema", schema: invoiceSchema as unknown as Record<string, unknown> } },
      messages: [{ role: "user", content: [source, { type: "text", text: "Extrae los datos de este documento de compra." }] }],
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new InvoiceReadError("El lector de documentos está ocupado; intenta en un minuto.");
    if (e instanceof Anthropic.APIError) throw new InvoiceReadError(`No se pudo leer el documento (${e.status ?? "error"}).`);
    throw e;
  }
  if (response.stop_reason === "refusal") throw new InvoiceReadError("No se pudo leer este documento. Ingresa la compra a mano.");
  if (response.stop_reason === "max_tokens") throw new InvoiceReadError("El documento es demasiado largo para leerlo de una vez.");

  const text = response.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text;
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* se informa abajo */ }
  const parsed = claudeResult.safeParse(json);
  if (!parsed.success) throw new InvoiceReadError("No se pudieron interpretar los datos del documento.");
  const r = parsed.data;
  if (!r.isPurchaseDocument) throw new InvoiceReadError("El archivo no parece una factura, boleta o guía de compra.");
  if (r.lines.length === 0) throw new InvoiceReadError("No se encontraron productos en el documento.");

  return {
    docType: r.docType,
    docNumber: r.docNumber,
    issuedOn: r.issuedOn && /^\d{4}-\d{2}-\d{2}$/.test(r.issuedOn) ? r.issuedOn : null,
    supplierName: r.supplierName,
    supplierRut: r.supplierRut,
    netTotal: r.netTotal,
    taxTotal: r.taxTotal,
    total: r.total,
    lines: r.lines.map(l => {
      const qty = l.quantity > 0 ? l.quantity : 1;
      let unit = l.lineTotal != null ? l.lineTotal / qty : l.unitPrice;
      if (r.pricesIncludeVat) unit = unit / (1 + VAT);
      return { description: l.description.trim(), supplierCode: l.code, quantity: qty, unit: l.unit?.toLowerCase() ?? null, unitCostNet: round2(unit) };
    }),
  };
}
