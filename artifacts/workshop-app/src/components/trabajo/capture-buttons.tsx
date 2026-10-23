import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { isMediaFile } from "@/lib/media-upload";
import { Camera, Image as ImageIcon, Video } from "lucide-react";

// Tres atajos para el celular: sacar una foto, grabar un video o elegir de la galería.
// `capture` abre directo la cámara trasera en iPhone y Android; en el computador abre el selector de archivos.
export function CaptureButtons({ onFiles, disabled, className }: { onFiles: (files: File[]) => void; disabled?: boolean; className?: string }) {
  const photo = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);

  const handle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter(isMediaFile);
    e.target.value = ""; // permite elegir el mismo archivo otra vez
    if (files.length > 0) onFiles(files);
  };

  return (
    <div className={className ?? "flex items-center gap-1"}>
      <Button type="button" variant="outline" size="sm" className="h-10 min-w-10" disabled={disabled} onClick={() => photo.current?.click()} data-testid="button-capture-photo">
        <Camera className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Foto</span><span className="sm:hidden sr-only">Sacar foto</span>
      </Button>
      <Button type="button" variant="outline" size="sm" className="h-10 min-w-10" disabled={disabled} onClick={() => video.current?.click()} data-testid="button-capture-video">
        <Video className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Video</span><span className="sm:hidden sr-only">Grabar video</span>
      </Button>
      <Button type="button" variant="outline" size="sm" className="h-10 min-w-10" disabled={disabled} onClick={() => gallery.current?.click()} data-testid="button-capture-gallery">
        <ImageIcon className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Galería</span><span className="sm:hidden sr-only">Elegir de la galería</span>
      </Button>
      <input ref={photo} type="file" accept="image/*" capture="environment" className="hidden" onChange={handle} data-testid="input-photos" />
      <input ref={video} type="file" accept="video/*" capture="environment" className="hidden" onChange={handle} data-testid="input-video" />
      <input ref={gallery} type="file" accept="image/*,video/*" multiple className="hidden" onChange={handle} data-testid="input-gallery" />
    </div>
  );
}
