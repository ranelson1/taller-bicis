import { useParams } from "wouter";
import { useGetPublicBikeHistory } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Bike, CalendarCheck, Phone, MapPin, SlidersHorizontal, Wrench, Package } from "lucide-react";

// Historial de mantención de una bicicleta (sin login). Se abre desde el link que comparte el taller:
// sirve para mostrar "mantenciones al día" al vender la bici o al llevarla a otro taller.

const BIKE_TYPES: Record<string, string> = { mtb: "MTB", road: "Ruta", gravel: "Gravel", urban: "Urbana", ebike: "E-Bike", kids: "Niños", other: "Otra" };
const day = (iso: string) => new Date(iso).toLocaleDateString("es-CL", { day: "numeric", month: "long", year: "numeric" });
const monthYear = (iso: string) => new Date(iso).toLocaleDateString("es-CL", { month: "long", year: "numeric" });

export default function HistorialPublico() {
  const { token } = useParams<{ token: string }>();
  const { data: h, isLoading, isError } = useGetPublicBikeHistory(token, { query: { queryKey: ["bike-history", token], retry: false } });

  if (isLoading) return <div className="min-h-screen bg-stone-50 p-4"><div className="max-w-xl mx-auto space-y-3 pt-6"><Skeleton className="h-28" /><Skeleton className="h-48" /></div></div>;
  if (isError || !h) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center p-6 text-center">
        <div>
          <Bike className="h-10 w-10 mx-auto text-stone-400 mb-3" />
          <h1 className="text-lg font-semibold text-stone-800">Este historial ya no está disponible</h1>
          <p className="text-sm text-stone-500 mt-1">Pídele al taller que te envíe el link nuevamente.</p>
        </div>
      </div>
    );
  }

  const { bicycle: b } = h;
  const meta = [b.year, BIKE_TYPES[b.type] ?? b.type, b.color, b.rimSize ? `${b.rimSize}"` : null].filter(Boolean).join(" · ");

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <header className="bg-white border-b border-stone-200">
        <div className="max-w-xl mx-auto px-4 py-4 flex items-center gap-3">
          {h.workshopLogoUrl
            ? <img src={h.workshopLogoUrl} alt={h.workshopName} className="h-10 w-10 rounded-lg object-cover" />
            : <div className="h-10 w-10 rounded-lg bg-orange-600 text-white flex items-center justify-center"><Wrench className="h-5 w-5" /></div>}
          <div className="min-w-0">
            <p className="font-semibold truncate">{h.workshopName}</p>
            <p className="text-xs text-stone-500">Historial de mantención</p>
          </div>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 py-5 space-y-4">
        <section className="rounded-2xl bg-white border border-stone-100 shadow-sm p-4" data-testid="bike-summary">
          <div className="flex items-start gap-3">
            <div className="h-11 w-11 rounded-xl bg-stone-100 flex items-center justify-center shrink-0"><Bike className="h-6 w-6 text-stone-600" /></div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold leading-tight">{b.brand} {b.model}</h1>
              {meta && <p className="text-sm text-stone-500">{meta}</p>}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-4 text-center">
            <div className="rounded-xl bg-stone-50 py-2"><p className="text-xl font-bold">{h.serviceCount}</p><p className="text-[11px] text-stone-500">servicio{h.serviceCount === 1 ? "" : "s"}</p></div>
            <div className="rounded-xl bg-stone-50 py-2"><p className="text-sm font-semibold mt-1 first-letter:uppercase">{h.firstServiceOn ? monthYear(h.firstServiceOn) : "—"}</p><p className="text-[11px] text-stone-500">primero</p></div>
            <div className="rounded-xl bg-stone-50 py-2"><p className="text-sm font-semibold mt-1 first-letter:uppercase">{h.lastServiceOn ? monthYear(h.lastServiceOn) : "—"}</p><p className="text-[11px] text-stone-500">último</p></div>
          </div>
        </section>

        {h.entries.length === 0 ? (
          <p className="text-center text-sm text-stone-500 py-8">Todavía no hay servicios registrados para esta bicicleta.</p>
        ) : (
          <section className="space-y-3">
            {h.entries.map((e, i) => (
              <article key={i} className="rounded-2xl bg-white border border-stone-100 shadow-sm p-4" data-testid={`history-entry-${i}`}>
                <p className="text-sm font-semibold flex items-center gap-2 text-orange-700"><CalendarCheck className="h-4 w-4" />{day(e.date)}</p>
                <ul className="mt-2 space-y-1.5">
                  {e.items.map((it, k) => (
                    <li key={k} className="text-sm flex items-start gap-2">
                      {it.kind === "part" ? <Package className="h-4 w-4 mt-0.5 text-stone-400 shrink-0" /> : <Wrench className="h-4 w-4 mt-0.5 text-stone-400 shrink-0" />}
                      <span>{it.description}{it.kind === "part" && it.quantity !== 1 ? ` × ${it.quantity}` : ""}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </section>
        )}

        {h.setupNotes && (
          <section className="rounded-2xl bg-white border border-stone-100 shadow-sm p-4">
            <p className="text-sm font-semibold flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-stone-500" />Ajustes de la bicicleta</p>
            <p className="text-sm text-stone-700 whitespace-pre-line mt-2">{h.setupNotes}</p>
            {h.setupUpdatedAt && <p className="text-[11px] text-stone-400 mt-2">Actualizado el {day(h.setupUpdatedAt)}</p>}
          </section>
        )}

        {(h.workshopPhone || h.workshopAddress) && (
          <footer className="text-xs text-stone-500 space-y-1 pt-2 text-center">
            <p>Registro llevado por {h.workshopName}</p>
            {h.workshopAddress && <p className="flex items-center justify-center gap-1"><MapPin className="h-3 w-3" />{h.workshopAddress}</p>}
            {h.workshopPhone && <p className="flex items-center justify-center gap-1"><Phone className="h-3 w-3" />{h.workshopPhone}</p>}
          </footer>
        )}
      </main>
    </div>
  );
}
