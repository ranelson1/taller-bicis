import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Mic, Square } from "lucide-react";

// Nota de voz: el mecánico explica lo que encontró en vez de escribirlo; el cliente la escucha en su link.
// Graba con el micrófono del celular (iPhone y Android) y entrega un archivo para subirlo como cualquier foto.

const MAX_SECONDS = 180;

// Safari (iPhone) graba en mp4/aac; Chrome y Android en webm/opus. Se elige lo que el navegador soporte.
function pickFormat(): { mime: string; ext: string } | null {
  if (typeof MediaRecorder === "undefined") return null;
  const options = [
    { mime: "audio/mp4", ext: "m4a" },
    { mime: "audio/webm;codecs=opus", ext: "webm" },
    { mime: "audio/webm", ext: "webm" },
    { mime: "audio/ogg;codecs=opus", ext: "ogg" },
  ];
  return options.find(o => MediaRecorder.isTypeSupported(o.mime)) ?? null;
}

export function VoiceRecorderDialog({ open, onOpenChange, onRecorded }: { open: boolean; onOpenChange: (o: boolean) => void; onRecorded: (file: File) => void }) {
  const [state, setState] = useState<"idle" | "recording" | "done">("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<number | null>(null);

  const cleanup = () => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach(t => t.stop());
    stream.current = null;
  };

  useEffect(() => {
    if (!open) {
      cleanup();
      if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
      setState("idle"); setSeconds(0); setError(null);
      setPreview(p => { if (p) URL.revokeObjectURL(p.url); return null; });
    }
    return cleanup;
  }, [open]);

  const start = async () => {
    setError(null);
    const format = pickFormat();
    if (!format || !navigator.mediaDevices?.getUserMedia) { setError("Este navegador no puede grabar audio. Usa Chrome o Safari actualizados."); return; }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("No pude usar el micrófono. Permite el acceso en la configuración del navegador y vuelve a intentar.");
      return;
    }
    chunks.current = [];
    const rec = new MediaRecorder(stream.current, { mimeType: format.mime });
    recorder.current = rec;
    rec.ondataavailable = e => { if (e.data.size > 0) chunks.current.push(e.data); };
    rec.onstop = () => {
      cleanup();
      const base = format.mime.split(";")[0];
      const file = new File(chunks.current, `nota-de-voz.${format.ext}`, { type: base });
      if (file.size === 0) { setState("idle"); setError("No se grabó nada. Intenta de nuevo."); return; }
      setPreview({ file, url: URL.createObjectURL(file) });
      setState("done");
    };
    rec.start();
    setSeconds(0);
    setState("recording");
    timer.current = window.setInterval(() => {
      setSeconds(s => {
        if (s + 1 >= MAX_SECONDS && recorder.current?.state === "recording") recorder.current.stop();
        return s + 1;
      });
    }, 1000);
  };

  const stop = () => { if (recorder.current?.state === "recording") recorder.current.stop(); };
  const retry = () => { setPreview(p => { if (p) URL.revokeObjectURL(p.url); return null; }); setState("idle"); setSeconds(0); };
  const send = () => { if (preview) { onRecorded(preview.file); onOpenChange(false); } };
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Mic className="h-5 w-5" />Nota de voz</DialogTitle>
          <DialogDescription>Cuéntale al cliente lo que encontraste. La escucha en su link, como un audio de WhatsApp.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-2">
          {state === "idle" && (
            <Button size="lg" className="h-20 w-20 rounded-full" onClick={start} aria-label="Empezar a grabar" data-testid="button-voice-start"><Mic className="h-8 w-8" /></Button>
          )}
          {state === "recording" && (
            <>
              <p className="text-3xl font-mono tabular-nums" role="timer" data-testid="voice-clock">{clock}</p>
              <p className="text-sm text-red-600 flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-600 animate-pulse" />Grabando…</p>
              <Button size="lg" variant="destructive" className="h-20 w-20 rounded-full" onClick={stop} aria-label="Terminar" data-testid="button-voice-stop"><Square className="h-7 w-7" /></Button>
            </>
          )}
          {state === "done" && preview && (
            <>
              <audio src={preview.url} controls className="w-full" data-testid="voice-preview" />
              <p className="text-xs text-muted-foreground">Dura {clock}. Escúchala antes de enviarla.</p>
            </>
          )}
          {error && <p className="text-sm text-destructive text-center" role="alert">{error}</p>}
        </div>
        {state === "done" && (
          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="outline" onClick={retry}>Grabar de nuevo</Button>
            <Button onClick={send} data-testid="button-voice-send">Agregar al trabajo</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
