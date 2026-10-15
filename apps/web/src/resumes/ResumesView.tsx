import { CheckCircle2, Circle, Download, FilePlus2, Languages, Loader2, MoreHorizontal, Trash2, UploadCloud } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { emptyResumeContent, RESUME_LANGUAGES, type ResumeLanguage, type ResumeListItem } from "@job/shared";
import { ApiError } from "../api/client";
import { useMe } from "../api/queries";
import { MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger } from "../layout/menu";
import { confirm } from "../lib/confirm";
import { errorMessage } from "../lib/errors";
import { formatAge } from "../lib/format";
import { toast } from "../lib/toast";
import type { TabViewProps } from "../views/registry";
import { useCreateResume, useDeleteResume, useResume, useResumes, useSelectResume, useTranslateResume, useUploadResume } from "./queries";
import { ResumeEditor } from "./ResumeEditor";

// Resumes tab (FRONTEND.md §2.3; FEATURE R1–R5, T1): the list with upload on the left, the
// open resume's editor on the right.

const ACCEPT = ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function UploadZone({ onUploaded }: { onUploaded: (id: string) => void }) {
  const { t } = useTranslation();
  const upload = useUploadResume();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const send = (file: File | undefined) => {
    if (!file) return;
    upload.mutate(file, { onSuccess: (resume) => onUploaded(resume.id), onError: (error) => toast(errorMessage(t, error), "error") });
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    send(event.dataTransfer.files[0]);
  };
  return (
    <button
      type="button"
      disabled={upload.isPending}
      onClick={() => input.current?.click()}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={`flex flex-col items-center gap-1.5 rounded-box border border-dashed px-3 py-5 text-center text-sm transition-colors duration-150 ${
        over ? "border-accent bg-accent-soft" : "border-border hover:border-accent hover:bg-hover"
      }`}
    >
      {upload.isPending ? (
        <>
          <Loader2 size={20} className="animate-spin text-accent" />
          <span className="font-medium">{t("resume.reading")}</span>
          <span className="text-xs text-fg-subtle">{t("resume.readingHint")}</span>
        </>
      ) : (
        <>
          <UploadCloud size={20} className="text-accent" />
          <span className="font-medium">{t("resume.upload")}</span>
          <span className="text-xs text-fg-subtle">{t("resume.uploadHint")}</span>
        </>
      )}
      <input ref={input} type="file" accept={ACCEPT} className="hidden" onChange={(event) => send(event.target.files?.[0])} />
    </button>
  );
}

function ResumeRow({ item, open, onOpen }: { item: ResumeListItem; open: boolean; onOpen: (id: string) => void }) {
  const { t, i18n } = useTranslation();
  const select = useSelectResume();
  const remove = useDeleteResume();
  const translate = useTranslateResume();
  const targets = RESUME_LANGUAGES.filter((language) => language !== item.language);

  const startTranslation = async (language: ResumeLanguage, force = false) => {
    try {
      const created = await translate.mutateAsync({ id: item.id, language, force });
      toast(t("resume.translated"));
      onOpen(created.id);
    } catch (error) {
      // A translation exists already: open it, or make a new one (FEATURE T1).
      if (error instanceof ApiError && error.code === "translation_exists") {
        const again = await confirm({ title: t("resume.translationExistsTitle"), text: t("resume.translationExists"), confirm: t("resume.translateAgain") });
        if (again) await startTranslation(language, true);
      } else toast(errorMessage(t, error), "error");
    }
  };

  return (
    <div className={`group flex items-center gap-2 rounded-control border-l-2 py-2 pl-2 pr-1 transition-colors ${open ? "border-accent bg-selected" : "border-transparent hover:bg-hover"}`}>
      <button
        type="button"
        aria-label={item.isSelected ? t("resume.selected") : t("resume.select")}
        title={item.isSelected ? t("resume.selectedHint") : t("resume.select")}
        onClick={() => !item.isSelected && select.mutate(item.id)}
        className={item.isSelected ? "text-accent" : "text-fg-subtle hover:text-fg"}
      >
        {item.isSelected ? <CheckCircle2 size={17} /> : <Circle size={17} />}
      </button>
      <button type="button" onClick={() => onOpen(item.id)} className="flex min-w-0 flex-1 flex-col items-start text-left">
        <span className="flex w-full items-center gap-1.5">
          <span className="truncate text-sm font-medium">{item.name}</span>
          <span className="shrink-0 rounded-sm bg-hover px-1 text-[10px] font-medium uppercase text-fg-muted">{item.language}</span>
        </span>
        <span className="truncate text-xs text-fg-subtle">
          {item.translatedFrom ? t("resume.translationOf", { name: item.translatedFrom.name }) : formatAge(item.updatedAt, i18n.language)}
        </span>
      </button>
      {translate.isPending && <Loader2 size={14} className="shrink-0 animate-spin text-accent" />}
      <MenuRoot>
        <MenuTrigger asChild>
          <button type="button" aria-label={t("resume.actions")} className="flex size-7 shrink-0 items-center justify-center rounded-control text-fg-subtle opacity-0 transition hover:bg-hover hover:text-fg group-hover:opacity-100 data-[state=open]:opacity-100 focus-visible:opacity-100">
            <MoreHorizontal size={15} />
          </button>
        </MenuTrigger>
        <MenuContent align="end">
          {!item.isSelected && <MenuItem onSelect={() => select.mutate(item.id)}>{t("resume.select")}</MenuItem>}
          {targets.map((language) => (
            <MenuItem key={language} onSelect={() => void startTranslation(language)}>
              <Languages size={14} /> {t("resume.translateTo", { language: t(`resume.languagesInText.${language}`) })}
            </MenuItem>
          ))}
          {item.hasSourceFile && (
            <MenuItem onSelect={() => window.open(`/api/resumes/${item.id}/source`, "_blank")}>
              <Download size={14} /> {t("resume.downloadOriginal")}
            </MenuItem>
          )}
          <MenuSeparator />
          <MenuItem
            onSelect={async () => {
              const ok = await confirm({ title: t("resume.deleteTitle"), text: t("resume.deleteText", { name: item.name }), confirm: t("resume.delete"), danger: true });
              if (ok) remove.mutate(item.id, { onSuccess: () => toast(t("resume.deleted"), "info"), onError: (error) => toast(errorMessage(t, error), "error") });
            }}
          >
            <Trash2 size={14} className="text-danger" /> {t("resume.delete")}
          </MenuItem>
        </MenuContent>
      </MenuRoot>
    </div>
  );
}

export default function ResumesView({ tab }: TabViewProps) {
  const { t } = useTranslation();
  const resumes = useResumes();
  const create = useCreateResume();
  const me = useMe().data?.user ?? null;
  const [openId, setOpenId] = useState<string | null>(null);
  const [imported, setImported] = useState<Set<string>>(new Set());
  const list = resumes.data?.results ?? [];
  const opened = useResume(openId);

  // Without a choice, the selected resume (else the first) is open.
  useEffect(() => {
    if (resumes.data && (openId === null || !list.some((item) => item.id === openId))) {
      setOpenId(list.find((item) => item.isSelected)?.id ?? list[0]?.id ?? null);
    }
  }, [resumes.data, openId, list]);

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-r border-border p-3">
        <UploadZone
          onUploaded={(id) => {
            setImported((current) => new Set(current).add(id));
            setOpenId(id);
          }}
        />
        <button
          type="button"
          disabled={create.isPending}
          onClick={() =>
            create.mutate(
              { language: "fr", content: emptyResumeContent(me?.email?.split("@")[0] ?? t("resume.newName")) },
              { onSuccess: (resume) => setOpenId(resume.id), onError: (error) => toast(errorMessage(t, error), "error") },
            )
          }
          className="flex h-8 items-center justify-center gap-1.5 rounded-control text-sm text-fg-muted transition-colors hover:bg-hover hover:text-fg"
        >
          <FilePlus2 size={15} /> {t("resume.createEmpty")}
        </button>
        <div className="flex flex-col gap-0.5">
          {resumes.isPending && Array.from({ length: 2 }, (_, index) => <div key={index} className="h-12 animate-pulse rounded-control bg-hover" />)}
          {list.map((item) => (
            <ResumeRow key={item.id} item={item} open={item.id === openId} onOpen={setOpenId} />
          ))}
        </div>
        {list.length > 0 && !list.some((item) => item.isSelected) && <p className="text-xs text-warning">{t("resume.noneSelected")}</p>}
      </div>
      <div className="min-w-0 flex-1 overflow-y-auto px-8 pb-10">
        {openId && opened.data ? (
          <ResumeEditor key={opened.data.id} resume={opened.data} tabKey={tab.key} justImported={imported.has(opened.data.id)} onOpen={setOpenId} />
        ) : openId && opened.isPending ? (
          <div className="flex flex-col gap-3 py-8">
            <div className="h-7 w-1/3 animate-pulse rounded-control bg-hover" />
            <div className="h-24 animate-pulse rounded-box bg-hover" />
          </div>
        ) : (
          resumes.data && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-fg-muted">
              <p className="max-w-sm">{t("resume.empty")}</p>
            </div>
          )
        )}
      </div>
    </div>
  );
}
