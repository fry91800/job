import * as Dialog from "@radix-ui/react-dialog";
import { ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";

// Optional square crop before a photo upload (FEATURE R6), in the browser: drag to move,
// slider, wheel or +/- to zoom, arrows to nudge. "Use the whole photo" sends the file as is.

const VIEW = 300; // crop frame, in screen pixels
const OUTPUT_MAX = 1000; // the server resizes to 1000 px anyway

type Frame = { zoom: number; x: number; y: number }; // image top-left inside the frame

export function CropDialog({ file, onDone, onCancel }: { file: File | null; onDone: (file: File) => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [frame, setFrame] = useState<Frame>({ zoom: 1, x: 0, y: 0 });
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    setSize(null);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  // The image always covers the square: scale ≥ the "cover" scale, edges never inside.
  const scaleOf = (zoom: number) => (size ? (VIEW / Math.min(size.w, size.h)) * zoom : 1);
  const clamp = (next: Frame): Frame => {
    if (!size) return next;
    const scale = scaleOf(next.zoom);
    return { zoom: next.zoom, x: Math.min(0, Math.max(VIEW - size.w * scale, next.x)), y: Math.min(0, Math.max(VIEW - size.h * scale, next.y)) };
  };
  // Zooming keeps the point at the centre of the frame in place.
  const zoomTo = (zoom: number) =>
    setFrame((current) => {
      const next = Math.min(4, Math.max(1, zoom));
      const ratio = scaleOf(next) / scaleOf(current.zoom);
      return clamp({ zoom: next, x: VIEW / 2 - (VIEW / 2 - current.x) * ratio, y: VIEW / 2 - (VIEW / 2 - current.y) * ratio });
    });

  const onLoad = (image: HTMLImageElement) => {
    const loaded = { w: image.naturalWidth, h: image.naturalHeight };
    setSize(loaded);
    const scale = VIEW / Math.min(loaded.w, loaded.h);
    setFrame({ zoom: 1, x: (VIEW - loaded.w * scale) / 2, y: (VIEW - loaded.h * scale) / 2 });
  };

  const crop = async () => {
    if (!file || !size || !url) return;
    const scale = scaleOf(frame.zoom);
    const side = VIEW / scale; // in image pixels
    const output = Math.round(Math.min(OUTPUT_MAX, side));
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = output;
    const image = new Image();
    image.src = url;
    await image.decode();
    canvas.getContext("2d")!.drawImage(image, -frame.x / scale, -frame.y / scale, side, side, 0, 0, output, output);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (blob) onDone(new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }));
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 20 : 5;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[event.key]) {
      event.preventDefault();
      setFrame((current) => clamp({ ...current, x: current.x + moves[event.key][0], y: current.y + moves[event.key][1] }));
    } else if (event.key === "+" || event.key === "=") zoomTo(frame.zoom + 0.1);
    else if (event.key === "-") zoomTo(frame.zoom - 0.1);
  };

  const scale = scaleOf(frame.zoom);
  return (
    <Dialog.Root open={file !== null} onOpenChange={(open) => !open && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="animate-fade-in fixed inset-0 z-40 bg-overlay" />
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4">
          <Dialog.Content className="animate-pop-in pointer-events-auto flex w-full max-w-[380px] flex-col items-center gap-4 rounded-box border border-border bg-surface p-5 shadow-float" aria-describedby={undefined}>
            <Dialog.Title className="self-start text-base font-semibold">{t("photos.cropTitle")}</Dialog.Title>
            <div
              role="application"
              aria-label={t("photos.cropArea")}
              tabIndex={0}
              onKeyDown={onKeyDown}
              onWheel={(event) => zoomTo(frame.zoom - event.deltaY * 0.0015)}
              onPointerDown={(event: PointerEvent) => {
                drag.current = { px: event.clientX, py: event.clientY, x: frame.x, y: frame.y };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event: PointerEvent) => {
                const start = drag.current;
                if (start) setFrame(clamp({ zoom: frame.zoom, x: start.x + event.clientX - start.px, y: start.y + event.clientY - start.py }));
              }}
              onPointerUp={() => (drag.current = null)}
              className="relative cursor-grab touch-none overflow-hidden rounded-box bg-hover active:cursor-grabbing"
              style={{ width: VIEW, height: VIEW }}
            >
              {url && (
                <img
                  src={url}
                  alt=""
                  draggable={false}
                  onLoad={(event) => onLoad(event.currentTarget)}
                  className="pointer-events-none absolute left-0 top-0 max-w-none origin-top-left select-none"
                  style={size ? { width: size.w * scale, height: size.h * scale, transform: `translate(${frame.x}px, ${frame.y}px)` } : { opacity: 0 }}
                />
              )}
              <div className="pointer-events-none absolute inset-0 rounded-box ring-1 ring-inset ring-white/40" />
            </div>
            <label className="flex w-full items-center gap-2 text-fg-muted">
              <ZoomOut size={16} />
              <input
                type="range"
                min={1}
                max={4}
                step={0.01}
                value={frame.zoom}
                aria-label={t("photos.zoom")}
                onChange={(event) => zoomTo(Number(event.target.value))}
                className="flex-1 accent-[var(--accent)]"
              />
              <ZoomIn size={16} />
            </label>
            <div className="flex w-full flex-wrap justify-end gap-2">
              <button type="button" onClick={() => file && onDone(file)} className="h-8 rounded-control border border-border px-3 text-sm transition-colors hover:bg-hover">
                {t("photos.useWhole")}
              </button>
              <button type="button" disabled={!size} onClick={() => void crop()} className="h-8 rounded-control bg-accent px-3 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-50">
                {t("photos.cropAndAdd")}
              </button>
            </div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
