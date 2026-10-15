import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ImageOff, Loader2, Pencil, Trash2, UploadCloud } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import type { Photo, PhotoListResponse } from "@job/shared";
import { api } from "../api/client";
import { confirm } from "../lib/confirm";
import { errorMessage } from "../lib/errors";
import { toast } from "../lib/toast";
import { CropDialog } from "./CropDialog";

// Photos tab (FEATURE R6): the user's photos, the selected one (or none) used on generated
// resumes; upload (JPEG, PNG, WEBP; the server removes metadata and resizes), rename,
// delete. Images come from an owner-only API route.

const KEY = ["photos"] as const;

function usePhotos() {
  return useQuery({ queryKey: KEY, queryFn: ({ signal }) => api<PhotoListResponse>("GET", "/api/photos", { signal }) });
}

function usePhotoMutation<T>(run: (input: T) => Promise<unknown>, optimistic?: (list: Photo[], input: T) => Photo[]) {
  const client = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: run,
    onMutate: (input) => {
      if (optimistic) client.setQueryData<PhotoListResponse>(KEY, (data) => data && { results: optimistic(data.results, input) });
    },
    onError: (error) => toast(errorMessage(t, error), "error"),
    onSettled: () => client.invalidateQueries({ queryKey: KEY }),
  });
}

function PhotoCard({ photo }: { photo: Photo }) {
  const { t } = useTranslation();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(photo.name);
  const select = usePhotoMutation(() => api("POST", `/api/photos/${photo.id}/select`), (list) => list.map((item) => ({ ...item, isSelected: item.id === photo.id })));
  const rename = usePhotoMutation((value: string) => api("PATCH", `/api/photos/${photo.id}`, { body: { name: value } }), (list, value) => list.map((item) => (item.id === photo.id ? { ...item, name: value } : item)));
  const remove = usePhotoMutation(() => api("DELETE", `/api/photos/${photo.id}`), (list) => list.filter((item) => item.id !== photo.id));
  const finishRename = () => {
    setRenaming(false);
    if (name.trim() && name.trim() !== photo.name) rename.mutate(name.trim());
    else setName(photo.name);
  };
  const tool = "flex size-7 items-center justify-center rounded-control bg-surface/90 text-fg-muted shadow-float backdrop-blur transition-colors hover:text-fg";
  return (
    <div className="group flex flex-col gap-2">
      <button
        type="button"
        onClick={() => !photo.isSelected && select.mutate(undefined)}
        aria-pressed={photo.isSelected}
        aria-label={photo.isSelected ? t("photos.selected") : t("photos.select")}
        className={`relative aspect-square overflow-hidden rounded-box border-2 bg-hover transition-colors duration-150 ${photo.isSelected ? "border-accent" : "border-transparent hover:border-border"}`}
      >
        <img src={`/api/photos/${photo.id}/file`} alt={photo.name} loading="lazy" className="size-full object-cover" />
        {photo.isSelected && <CheckCircle2 size={20} className="absolute left-2 top-2 rounded-full bg-surface text-accent" />}
      </button>
      <div className="flex items-center gap-1">
        {renaming ? (
          <input
            autoFocus
            value={name}
            aria-label={t("photos.rename")}
            onChange={(event) => setName(event.target.value)}
            onBlur={finishRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") finishRename();
              if (event.key === "Escape") {
                setName(photo.name);
                setRenaming(false);
              }
            }}
            className="h-7 min-w-0 flex-1 rounded-control border border-accent bg-bg px-2 text-sm outline-none"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm">{photo.name}</span>
        )}
        <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button type="button" className={tool} aria-label={t("photos.rename")} onClick={() => setRenaming(true)}>
            <Pencil size={13} />
          </button>
          <button
            type="button"
            className={tool}
            aria-label={t("photos.delete")}
            onClick={async () => {
              if (await confirm({ title: t("photos.deleteTitle"), text: t("photos.deleteText"), confirm: t("photos.delete"), danger: true })) remove.mutate(undefined);
            }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PhotosView() {
  const { t } = useTranslation();
  const photos = usePhotos();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const upload = usePhotoMutation((file: File) => api<Photo>("POST", "/api/photos", { file }));
  const noPhoto = usePhotoMutation(() => api("DELETE", "/api/photos/selection"), (list) => list.map((item) => ({ ...item, isSelected: false })));
  const list = photos.data?.results ?? [];
  // A chosen file is offered for cropping first (FEATURE R6, optional).
  const [toCrop, setToCrop] = useState<File | null>(null);
  const send = (file: File | undefined) => file && setToCrop(file);
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    send(event.dataTransfer.files[0]);
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-8 py-8" onDragOver={(event) => { event.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">{t("photos.title")}</h1>
        <p className="text-sm text-fg-muted">{t("photos.intro")}</p>
      </header>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4">
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={upload.isPending}
          className={`flex aspect-square flex-col items-center justify-center gap-2 rounded-box border border-dashed text-sm transition-colors duration-150 ${over ? "border-accent bg-accent-soft" : "border-border hover:border-accent hover:bg-hover"}`}
        >
          {upload.isPending ? <Loader2 size={20} className="animate-spin text-accent" /> : <UploadCloud size={20} className="text-accent" />}
          <span className="font-medium">{t("photos.upload")}</span>
          <span className="px-3 text-center text-xs text-fg-subtle">{t("photos.uploadHint")}</span>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(event) => {
              send(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </button>
        {list.length > 0 && (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => noPhoto.mutate(undefined)}
              aria-pressed={!list.some((photo) => photo.isSelected)}
              className={`flex aspect-square flex-col items-center justify-center gap-2 rounded-box border-2 bg-hover text-sm text-fg-muted transition-colors ${!list.some((photo) => photo.isSelected) ? "border-accent" : "border-transparent hover:border-border"}`}
            >
              <ImageOff size={22} />
              {t("photos.none")}
            </button>
            <span className="text-sm text-fg-muted">{t("photos.noneHint")}</span>
          </div>
        )}
        {photos.isPending && Array.from({ length: 3 }, (_, index) => <div key={index} className="aspect-square animate-pulse rounded-box bg-hover" />)}
        {list.map((photo) => (
          <PhotoCard key={photo.id} photo={photo} />
        ))}
      </div>
      <CropDialog
        file={toCrop}
        onCancel={() => setToCrop(null)}
        onDone={(file) => {
          setToCrop(null);
          upload.mutate(file);
        }}
      />
    </div>
  );
}
