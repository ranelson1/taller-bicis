// Links directos al chat de WhatsApp de un cliente (wa.me abre la app en el celular
// y WhatsApp Web/Desktop en el computador).

// Normaliza un teléfono chileno al formato internacional sin "+" (56912345678).
// Acepta "+56 9 1234 5678", "9 1234 5678", "912345678", "12345678" (celular sin el 9)
// y números de otros países si vienen con su código ("+54 ...").
export function whatsappNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (phone.trim().startsWith("00")) digits = digits.slice(2);
  if (digits.length === 8) digits = `569${digits}`;              // 12345678 → celular sin el 9
  else if (digits.length === 9 && digits.startsWith("9")) digits = `56${digits}`; // 912345678
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

export function whatsappLink(phone: string | null | undefined, text?: string): string | null {
  const number = whatsappNumber(phone);
  if (!number) return null;
  return `https://wa.me/${number}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}
