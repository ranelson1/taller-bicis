import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListWorkOrderPhotos, useUpdateWorkOrderPhoto, useDeleteWorkOrderPhoto,
  getListWorkOrderPhotosQueryKey, type WorkOrderPhoto,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { resizeImage } from "@/lib/image";
import { Camera, EyeOff, ImagePlus, Loader2, Play, Trash2 } from "lucide-react";

// Fotos de la OT: el mecánico las saca desde el celular (cámara o galería), les pone una nota
// y decide si el cliente las ve en su link.

const MAX_VIDEO_MB = 60;
const isVideo = (mime?: string | null) => !!mime && mime.startsWith("video/");

async function uploadPhoto(workOrderId: number, file: File): Promise<void> {
  const video = file.type.startsWith("video/");
  if (video && file.size > MAX_VIDEO_MB * 1024 * 1024) throw new Error(`El video pesa más de ${MAX_VIDEO_MB} MB`);
  const blob = video ? file : await resizeImage(file);
  const res = await fetch(`/api/work-orders/${workOrderId}/photos`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": video ? file.type : "image/jpeg" },
    body: blob,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? "No se pudo subir la foto");
  }
}

export function PhotosCard({ workOrderId, readOnly }: { workOrderId: number; readOnly?: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: photos } = useListWorkOrderPhotos(workOrderId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [open, setOpen] = useState<WorkOrderPhoto | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: getListWorkOrderPhotosQueryKey(workOrderId) });

  const onFiles = async (files: FileList | null) => {
    const list = Array.from(files ?? []).filter(f => f.type.startsWith("image/") || f.type.startsWith("video/"));
    if (list.length === 0) return;
    setUploading({ done: 0, total: list.length });
    let failed = 0;
    let lastError = "";
    for (let i = 0; i < list.length; i++) {
      try { await uploadPhoto(workOrderId, list[i]); } catch (e) { failed++; lastError = e instanceof Error ? e.message : ""; }
      setUploading({ done: i + 1, total: list.length });
    }
    setUploading(null);
    if (inputRef.current) inputRef.current.value = "";
    refresh();
    toast(failed === 0
      ? { title: list.length === 1 ? "Archivo agregado" : `${list.length} archivos agregados` }
      : { variant: "destructive", title: `No se pudieron subir ${failed} de ${list.length}`, description: lastError || undefined });
  };

  const items = photos ?? [];

  return (
    <Card>
      <CardHeader className="pb-1 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
          <Camera className="h-4 w-4" />Fotos y videos {items.length > 0 && <span className="font-normal">({items.length})</span>}
        </CardTitle>
        {!readOnly && (
          <Button variant="ghost" size="sm" className="text-primary -mr-2" disabled={!!uploading} onClick={() => inputRef.current?.click()} data-testid="button-add-photos">
            {uploading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <ImagePlus className="h-4 w-4 mr-1" />}
            {uploading ? `Subiendo ${uploading.done}/${uploading.total}` : "Agregar"}
          </Button>
        )}
        {/* Sin `capture`: en el celular deja elegir entre cámara y galería. */}
        <input ref={inputRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={e => onFiles(e.target.files)} data-testid="input-photos" />
      </CardHeader>
      <CardContent className="pt-0">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-1">
            {readOnly ? "Sin fotos ni videos." : "Saca fotos o videos de cómo llegó la bici, de lo que encuentres y del trabajo terminado."}
          </p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {items.map(p => (
              <button key={p.id} type="button" onClick={() => setOpen(p)} className="relative aspect-square overflow-hidden rounded-md border bg-muted group" data-testid={`photo-${p.id}`}>
                {isVideo(p.mimeType) ? (
                  <>
                    <video src={`${p.url}#t=0.1`} preload="metadata" muted playsInline className="h-full w-full object-cover" />
                    <span className="absolute inset-0 flex items-center justify-center"><span className="rounded-full bg-black/55 p-2 text-white"><Play className="h-4 w-4" /></span></span>
                  </>
                ) : (
                  <img src={p.url} alt={p.note ?? "Foto de la OT"} loading="lazy" className="h-full w-full object-cover group-hover:opacity-90" />
                )}
                {!p.visibleToClient && (
                  <span className="absolute top-1 right-1 rounded-full bg-black/60 p-1 text-white" title="Solo el taller la ve"><EyeOff className="h-3 w-3" /></span>
                )}
                {p.note && <span className="absolute inset-x-0 bottom-0 bg-black/55 px-1.5 py-0.5 text-[10px] text-white text-left truncate">{p.note}</span>}
              </button>
            ))}
          </div>
        )}
      </CardContent>

      <PhotoDialog photo={open} workOrderId={workOrderId} readOnly={readOnly} onClose={() => setOpen(null)} onChanged={refresh} />
    </Card>
  );
}

function PhotoDialog({ photo, workOrderId, readOnly, onClose, onChanged }: {
  photo: WorkOrderPhoto | null; workOrderId: number; readOnly?: boolean; onClose: () => void; onChanged: () => void;
}) {
  const { toast } = useToast();
  const update = useUpdateWorkOrderPhoto();
  const remove = useDeleteWorkOrderPhoto();
  const [note, setNote] = useState("");
  const [visible, setVisible] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [loadedFor, setLoadedFor] = useState<number | null>(null);

  // Cargar los valores de la foto al abrirla.
  if (photo && loadedFor !== photo.id) {
    setLoadedFor(photo.id);
    setNote(photo.note ?? "");
    setVisible(photo.visibleToClient);
    setConfirmDelete(false);
  }

  const save = () => {
    if (!photo) return;
    update.mutate({ id: workOrderId, photoId: photo.id, data: { note: note.trim() || null, visibleToClient: visible } }, {
      onSuccess: () => { toast({ title: "Guardado" }); onChanged(); onClose(); },
      onError: () => toast({ variant: "destructive", title: "No se pudo guardar" }),
    });
  };
  const del = () => {
    if (!photo) return;
    remove.mutate({ id: workOrderId, photoId: photo.id }, {
      onSuccess: () => { toast({ title: "Eliminado" }); onChanged(); onClose(); },
      onError: () => toast({ variant: "destructive", title: "No se pudo eliminar" }),
    });
  };

  return (
    <Dialog open={!!photo} onOpenChange={o => { if (!o) { setLoadedFor(null); onClose(); } }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{photo && isVideo(photo.mimeType) ? "Video" : "Foto"} · {photo ? new Date(photo.createdAt).toLocaleString("es-CL", { dateStyle: "medium", timeStyle: "short" }) : ""}</DialogTitle>
        </DialogHeader>
        {photo && (
          isVideo(photo.mimeType) ? (
            <video src={photo.url} controls playsInline preload="metadata" className="w-full max-h-[60vh] rounded-md bg-black" />
          ) : (
            <a href={photo.url} target="_blank" rel="noreferrer">
              <img src={photo.url} alt={photo.note ?? "Foto de la OT"} className="w-full max-h-[60vh] object-contain rounded-md bg-muted" />
            </a>
          )
        )}
        {readOnly ? (
          photo?.note && <p className="text-sm">{photo.note}</p>
        ) : (
          <div className="space-y-3">
            <Textarea rows={2} placeholder="Nota (ej: pastillas al 10%, disco rayado)" value={note} onChange={e => setNote(e.target.value)} maxLength={500} data-testid="textarea-photo-note" />
            <label className="flex items-center justify-between gap-3 text-sm cursor-pointer rounded-md border p-3">
              <span>
                <span className="font-medium block">Visible para el cliente</span>
                <span className="text-xs text-muted-foreground">Aparece con su nota en el link de seguimiento</span>
              </span>
              <Switch checked={visible} onCheckedChange={setVisible} data-testid="switch-photo-visible" />
            </label>
          </div>
        )}
        {!readOnly && (
          <DialogFooter className="gap-2 sm:justify-between">
            {confirmDelete ? (
              <Button variant="destructive" onClick={del} disabled={remove.isPending} data-testid="button-confirm-delete-photo">Sí, eliminar</Button>
            ) : (
              <Button variant="ghost" className="text-destructive" onClick={() => setConfirmDelete(true)}><Trash2 className="h-4 w-4 mr-1" />Eliminar</Button>
            )}
            <Button onClick={save} disabled={update.isPending} data-testid="button-save-photo">Guardar</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
