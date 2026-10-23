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

// Mensaje para cobrar un saldo pendiente (lo envía el taller con un toque, desde su WhatsApp).
export function paymentReminder(
  clientName: string | null | undefined, shopName: string | null | undefined, amount: string, orderNumber: string, paymentInfo?: string | null,
): string {
  const first = (clientName ?? "").split(" ")[0];
  const base = `Hola${first ? ` ${first}` : ""}, te escribimos de ${shopName || "el taller"}. Queda un saldo de ${amount} de la orden ${orderNumber}.`;
  return paymentInfo?.trim()
    ? `${base} Puedes transferir a:\n${paymentInfo.trim()}\n¡Gracias!`
    : `${base} ¿Cuándo podrías pasar a pagarlo? ¡Gracias!`;
}

// Confirmación de una reserva: día, hora, bici y cuándo estimamos tenerla lista.
export function reservationMessage(
  r: { clientName: string; expectedOn: string; expectedTime?: string | null; bicycleText?: string | null; estimatedDeliveryDate?: string | null },
  shopName: string | null | undefined,
): string {
  const first = r.clientName.split(" ")[0];
  const day = new Date(`${r.expectedOn}T12:00:00`).toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long" });
  const ready = r.estimatedDeliveryDate
    ? ` Estimamos tenerla lista el ${new Date(r.estimatedDeliveryDate).toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long" })}.`
    : "";
  return `Hola ${first}, te esperamos el ${day}${r.expectedTime ? ` a las ${r.expectedTime}` : ""} en ${shopName || "el taller"}${r.bicycleText ? ` con tu ${r.bicycleText}` : ""}.${ready} ¡Nos vemos!`;
}

// Recontacto: ya le toca repetir un servicio. Un servicio => lo nombra; varios => los lista.
export function followupMessage(
  client: { clientName: string; items: { serviceName: string; bicycleName: string; monthsAgo: number }[] },
  shopName: string | null | undefined,
): string {
  const first = client.clientName.split(" ")[0];
  const lead = client.items[0];
  const bikes = [...new Set(client.items.map(i => i.bicycleName))];
  const months = `${lead.monthsAgo} mes${lead.monthsAgo === 1 ? "" : "es"}`;
  const what = client.items.length === 1
    ? `el ${lead.serviceName.charAt(0).toLowerCase()}${lead.serviceName.slice(1)} de tu ${lead.bicycleName}`
    : `los servicios de tu ${bikes.join(" y ")} (${client.items.map(i => i.serviceName.toLowerCase()).join(", ")})`;
  return `Hola ${first}, te escribimos de ${shopName || "el taller"}. Hace ${months} hicimos ${what} y ya toca repetirlo. ¿Te reservamos un día esta semana?`;
}
