import { ArrowDown, ArrowUp, Languages, Loader2, Plus, Trash2, X } from "lucide-react";
import { createContext, useContext, useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { errorMessage } from "../lib/errors";
import { toast } from "../lib/toast";
import { translateField } from "./queries";

// Form pieces for the resume editor (FEATURE R3). Errors are looked up by the content path
// ("workExperience.0.jobTitle"); on a translated resume (T1) text fields also show the
// original text and can ask for that one field to be translated again.

export type EditorContextValue = {
  errors: Map<string, string>;
  resumeId: string;
  isTranslation: boolean;
};
export const EditorContext = createContext<EditorContextValue>({ errors: new Map(), resumeId: "", isTranslation: false });

// A field of a translated resume: its API path (with item ids) and the original text.
export type Translation = { path: string; original: string | null | undefined };

const inputClass =
  "w-full rounded-control border border-border bg-bg px-2.5 py-1.5 outline-none transition-colors duration-150 placeholder:text-fg-subtle focus:border-accent aria-[invalid=true]:border-danger";

function Original({ translation, onChange }: { translation: Translation; onChange: (value: string) => void }) {
  const { t } = useTranslation();
  const { resumeId } = useContext(EditorContext);
  const [busy, setBusy] = useState(false);
  if (!translation.original) return null;
  return (
    <div className="flex items-start gap-2 rounded-control bg-hover/60 px-2.5 py-1.5 text-xs text-fg-muted">
      <span className="min-w-0 flex-1 whitespace-pre-line">
        <span className="font-medium text-fg-subtle">{t("resume.original")} </span>
        {translation.original}
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            onChange((await translateField(resumeId, translation.path)).text);
          } catch (error) {
            toast(errorMessage(t, error), "error");
          } finally {
            setBusy(false);
          }
        }}
        className="flex shrink-0 items-center gap-1 text-accent hover:underline disabled:opacity-60"
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Languages size={12} />}
        {t("resume.retranslate")}
      </button>
    </div>
  );
}

export function TextField(props: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  errorPath?: string;
  multiline?: boolean;
  placeholder?: string;
  translation?: Translation;
  className?: string;
  hideLabel?: boolean; // the label is read by screen readers only (items of a list)
}) {
  const id = useId();
  const { errors, isTranslation } = useContext(EditorContext);
  const error = props.errorPath ? errors.get(props.errorPath) : undefined;
  const common = {
    id,
    value: props.value ?? "",
    placeholder: props.placeholder,
    "aria-invalid": !!error,
    onChange: (event: { target: { value: string } }) => props.onChange(event.target.value === "" ? null : event.target.value),
  };
  return (
    <div className={`flex flex-col gap-1 ${props.className ?? ""}`}>
      <label htmlFor={id} className={props.hideLabel ? "sr-only" : "text-xs font-medium text-fg-muted"}>
        {props.label}
      </label>
      {props.multiline ? <textarea {...common} rows={3} className={`${inputClass} field-sizing-content min-h-16 resize-y`} /> : <input {...common} className={`${inputClass} h-8`} />}
      {isTranslation && props.translation && <Original translation={props.translation} onChange={props.onChange} />}
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}

// "YYYY" or "YYYY-MM".
export function DateField(props: { label: string; value: string | null; onChange: (value: string | null) => void; errorPath: string; disabled?: boolean }) {
  const { t } = useTranslation();
  return props.disabled ? (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-fg-muted">{props.label}</span>
      <span className="flex h-8 items-center text-sm text-fg-subtle">{t("resume.present")}</span>
    </div>
  ) : (
    <TextField label={props.label} value={props.value} onChange={props.onChange} errorPath={props.errorPath} placeholder={t("resume.datePlaceholder")} />
  );
}

// A list of short texts as chips: Enter or comma adds, × removes.
export function TagsField({ label, values, onChange }: { label: string; values: string[]; onChange: (values: string[]) => void }) {
  const { t } = useTranslation();
  const id = useId();
  const [text, setText] = useState("");
  const add = () => {
    const parts = text.split(",").map((part) => part.trim()).filter((part) => part && !values.includes(part));
    if (parts.length) onChange([...values, ...parts]);
    setText("");
  };
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-fg-muted">
        {label}
      </label>
      <div className="flex min-h-8 flex-wrap items-center gap-1.5 rounded-control border border-border bg-bg px-1.5 py-1 transition-colors focus-within:border-accent">
        {values.map((value) => (
          <span key={value} className="flex items-center gap-1 rounded-full bg-hover py-0.5 pl-2 pr-1 text-xs">
            {value}
            <button type="button" aria-label={t("resume.remove")} onClick={() => onChange(values.filter((item) => item !== value))} className="rounded-full p-0.5 text-fg-subtle hover:text-fg">
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={text}
          placeholder={values.length ? "" : t("resume.tagsPlaceholder")}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              add();
            } else if (event.key === "Backspace" && !text && values.length) onChange(values.slice(0, -1));
          }}
          onBlur={add}
          className="h-6 min-w-24 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-fg-subtle"
        />
      </div>
    </div>
  );
}

// Items of a section (jobs, projects…): each in a card with move and remove buttons.
export function ItemList<T extends { id: string }>(props: {
  items: T[];
  onChange: (items: T[]) => void;
  newItem: () => T;
  addLabel: string;
  title: (item: T) => string;
  children: (item: T, index: number, update: (change: Partial<T>) => void) => ReactNode;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const { items, onChange } = props;
  const move = (index: number, by: number) => {
    const next = [...items];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    onChange(next);
  };
  const tool = "flex size-6 items-center justify-center rounded-control text-fg-subtle transition-colors hover:bg-hover hover:text-fg disabled:opacity-30";
  return (
    <div className="flex flex-col gap-2">
      {items.map((item, index) => (
        <div key={item.id} className={props.compact ? "flex items-start gap-2" : "flex flex-col gap-3 rounded-box border border-border bg-surface p-3"}>
          {!props.compact && (
            <div className="flex items-center gap-1">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{props.title(item) || t("resume.untitled")}</span>
              <button type="button" className={tool} aria-label={t("resume.moveUp")} disabled={index === 0} onClick={() => move(index, -1)}>
                <ArrowUp size={13} />
              </button>
              <button type="button" className={tool} aria-label={t("resume.moveDown")} disabled={index === items.length - 1} onClick={() => move(index, 1)}>
                <ArrowDown size={13} />
              </button>
              <button type="button" className={tool} aria-label={t("resume.remove")} onClick={() => onChange(items.filter((other) => other.id !== item.id))}>
                <Trash2 size={13} />
              </button>
            </div>
          )}
          <div className={props.compact ? "min-w-0 flex-1" : "contents"}>{props.children(item, index, (change) => onChange(items.map((other) => (other.id === item.id ? { ...other, ...change } : other))))}</div>
          {props.compact && (
            <button type="button" className={`${tool} mt-1`} aria-label={t("resume.remove")} onClick={() => onChange(items.filter((other) => other.id !== item.id))}>
              <Trash2 size={13} />
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, props.newItem()])}
        className="flex h-8 items-center gap-1.5 self-start rounded-control px-2 text-sm text-accent transition-colors hover:bg-accent-soft"
      >
        <Plus size={14} /> {props.addLabel}
      </button>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="border-b border-border pb-1.5 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

// Ids for new items, as the API accepts them ([A-Za-z0-9_-]{1,32}).
export const newId = () => `n${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
