import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock } from "lucide-react";

export default function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
          {title}
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary">
            Próximamente
          </span>
        </h1>
        <p className="text-muted-foreground mt-2">{description}</p>
      </div>

      <Card className="border-dashed border-2 bg-muted/20 h-64 flex flex-col items-center justify-center text-center p-6">
        <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
          <Clock className="h-8 w-8 text-muted-foreground" />
        </div>
        <CardTitle className="mb-2 text-xl">Módulo en Desarrollo</CardTitle>
        <CardContent className="text-muted-foreground max-w-md p-0">
          Esta funcionalidad está planeada para una próxima etapa. Seguimos construyendo las herramientas base del taller.
        </CardContent>
      </Card>
    </div>
  );
}
