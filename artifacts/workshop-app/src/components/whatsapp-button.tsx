import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { whatsappLink } from "@/lib/whatsapp";

// Ícono oficial simplificado de WhatsApp (lucide no lo trae).
export function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.66.15-.2.3-.76.96-.93 1.16-.17.2-.34.22-.64.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.75-1.65-2.05-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.66-1.6-.91-2.19-.24-.58-.48-.5-.66-.5h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.06 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.48.71.31 1.26.49 1.7.63.71.22 1.36.19 1.87.12.57-.09 1.75-.72 2-1.41.25-.69.25-1.29.17-1.41-.07-.12-.27-.2-.57-.35zM12.05 21.5h-.01a9.43 9.43 0 0 1-4.8-1.32l-.35-.2-3.57.93.96-3.48-.23-.36a9.4 9.4 0 0 1-1.44-5.02c0-5.2 4.24-9.44 9.45-9.44a9.38 9.38 0 0 1 6.68 2.77 9.38 9.38 0 0 1 2.76 6.68c0 5.21-4.24 9.44-9.45 9.44zm8.04-17.48A11.3 11.3 0 0 0 12.05.7C5.78.7.68 5.8.68 12.06c0 2 .52 3.96 1.52 5.68L.6 23.3l5.7-1.5a11.33 11.33 0 0 0 5.75 1.47h.01c6.26 0 11.36-5.1 11.36-11.36 0-3.04-1.18-5.89-3.33-8.04z" />
    </svg>
  );
}

type Props = {
  phone: string | null | undefined;
  text?: string;
  label?: string;           // sin label: botón solo con ícono
  size?: "sm" | "default" | "icon";
  className?: string;
};

// Abre el chat de WhatsApp con el cliente. Si el teléfono no sirve, el botón queda deshabilitado
// con la explicación en el tooltip.
export function WhatsAppButton({ phone, text, label, size = "sm", className }: Props) {
  const href = whatsappLink(phone, text);
  const title = href ? "Abrir chat de WhatsApp" : phone ? "Teléfono incompleto para WhatsApp" : "El cliente no tiene teléfono";
  const classes = cn("bg-[#25D366] hover:bg-[#1ebe5a] text-white", !label && "px-2", className);

  if (!href) {
    return (
      <Button type="button" size={size} disabled title={title} aria-label={title} className={classes}>
        <WhatsAppIcon className="h-4 w-4" />{label && <span className="ml-1.5">{label}</span>}
      </Button>
    );
  }
  return (
    <Button asChild size={size} className={classes}>
      <a href={href} target="_blank" rel="noreferrer" title={title} aria-label={title} data-testid="button-whatsapp-chat"
        onClick={e => e.stopPropagation()}>
        <WhatsAppIcon className="h-4 w-4" />{label && <span className="ml-1.5">{label}</span>}
      </a>
    </Button>
  );
}
