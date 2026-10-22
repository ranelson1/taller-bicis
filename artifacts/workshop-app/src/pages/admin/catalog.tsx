import { useLocation, useSearch } from "wouter";
import { cn } from "@/lib/utils";
import Services from "./services";
import Parts from "./parts";
import Categories from "./categories";

// Catálogo: servicios, repuestos y categorías en una sola página con pestañas.
const TABS = [
  { value: "servicios", label: "Servicios", Component: Services },
  { value: "repuestos", label: "Repuestos", Component: Parts },
  { value: "categorias", label: "Categorías", Component: Categories },
] as const;

export default function Catalog() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const current = TABS.find(t => t.value === new URLSearchParams(search).get("tab")) ?? TABS[0];

  return (
    <div>
      <div className="px-4 md:px-8 pt-4 md:pt-8 max-w-7xl mx-auto">
        <div className="inline-flex rounded-lg border bg-muted p-1 gap-1">
          {TABS.map(t => (
            <button key={t.value} type="button" onClick={() => navigate(`/admin/catalogo?tab=${t.value}`)} data-testid={`tab-${t.value}`}
              className={cn("rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
                current.value === t.value ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <current.Component />
    </div>
  );
}
