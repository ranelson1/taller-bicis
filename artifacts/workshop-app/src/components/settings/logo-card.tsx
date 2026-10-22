import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useDeleteWorkshopLogo, getGetWorkshopSettingsQueryKey, getGetMeQueryKey, type WorkshopSettings } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { resizeLogo } from "@/lib/image";
import { ImagePlus, Loader2, Trash2, Wrench } from "lucide-react";

// Logo del taller: aparece en el menú y en el link de seguimiento que recibe el cliente.
export function LogoCard({ settings }: { settings: WorkshopSettings }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const remove = useDeleteWorkshopLogo();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: getGetWorkshopSettingsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const blob = await resizeLogo(file);
      const res = await fetch("/api/settings/logo", { method: "POST", credentials: "include", headers: { "Content-Type": "image/png" }, body: blob });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "No se pudo subir el logo");
      toast({ title: "Logo actualizado" });
      refresh();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "No se pudo subir el logo" });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Logo</CardTitle>
        <CardDescription>Sale en el menú y en el link que le mandas al cliente.</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-4">
        <div className="h-20 w-20 rounded-xl border bg-muted flex items-center justify-center overflow-hidden shrink-0">
          {settings.logoUrl ? <img src={settings.logoUrl} alt="Logo del taller" className="h-full w-full object-contain" /> : <Wrench className="h-8 w-8 text-muted-foreground" />}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={uploading} data-testid="button-upload-logo">
            {uploading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <ImagePlus className="h-4 w-4 mr-1" />}
            {settings.logoUrl ? "Cambiar" : "Subir logo"}
          </Button>
          {settings.logoUrl && (
            <Button variant="ghost" className="text-destructive" disabled={remove.isPending}
              onClick={() => remove.mutate(undefined, { onSuccess: () => { toast({ title: "Logo quitado" }); refresh(); } })}>
              <Trash2 className="h-4 w-4 mr-1" />Quitar
            </Button>
          )}
        </div>
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={e => upload(e.target.files?.[0])} />
      </CardContent>
    </Card>
  );
}
