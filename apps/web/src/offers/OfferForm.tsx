import { Loader2 } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CONTRACT_TYPES, offerDraftSchema, REMOTE_TYPES, SALARY_PERIODS, type LocationSummary, type OfferDraft } from "@job/shared";
import { LocationInput } from "../search/LocationInput";

// The fields of a user-added offer (FEATURE O5), as extracted by the AI or as saved:
// reviewed and corrected by the user, checked with the API's schema before sending.

export type OfferFormValue = OfferDraft & { location: { id: number; name: string } | null };

const input = "w-full rounded-control border border-border bg-bg px-2.5 outline-none transition-colors focus:border-accent aria-[invalid=true]:border-danger";

// A label linked to its control by id (a label wrapping a <select> would read its options
// into the field's name).
function Field({ label, error, children, className = "" }: { label: string; error?: string; children: (id: string) => ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={`flex flex-col gap-1 text-xs font-medium text-fg-muted ${className}`}>
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {error && <span className="font-normal text-danger">{error}</span>}
    </div>
  );
}

export function OfferForm({ initial, submitLabel, pending, error, onSubmit, onCancel }: {
  initial: OfferFormValue;
  submitLabel: string;
  pending: boolean;
  error?: string | null;
  onSubmit: (draft: OfferDraft) => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initial);
  const [errors, setErrors] = useState(new Map<string, string>());
  const set = (change: Partial<OfferFormValue>) => setValue((current) => ({ ...current, ...change }));
  const number = (text: string) => (text.trim() === "" ? null : Number(text.replace(/\D/g, "")));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const { location, ...draft } = value;
    const check = offerDraftSchema.safeParse({ ...draft, locationId: location?.id ?? null });
    if (!check.success) {
      setErrors(
        new Map(
          check.error.issues.map((issue) => {
            const key = String(issue.path[0]);
            const message = issue.code === "too_small" ? t("resume.errors.required") : key === "url" ? t("addOffer.invalidUrl") : key === "salaryMax" ? t("addOffer.salaryOrder") : key === "salaryCurrency" ? t("addOffer.salaryUnit") : issue.message;
            return [key, message];
          }),
        ),
      );
      return;
    }
    setErrors(new Map());
    onSubmit(check.data);
  };

  const select = `${input} h-9 text-sm text-fg`;
  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("addOffer.fields.title")} error={errors.get("title")} className="sm:col-span-2">
          {(id) => (
            <input id={id} className={`${input} h-9 text-base font-medium text-fg`} value={value.title} aria-invalid={errors.has("title")} onChange={(event) => set({ title: event.target.value })} />
          )}
        </Field>
        <Field label={t("addOffer.fields.company")}>
          {(id) => (
            <input id={id} className={`${input} h-9 text-sm text-fg`} value={value.companyName ?? ""} onChange={(event) => set({ companyName: event.target.value || null })} />
          )}
        </Field>
        <div className="flex flex-col gap-1 text-xs font-medium text-fg-muted">
          {t("addOffer.fields.location")}
          <LocationInput value={value.location} onChange={(place: LocationSummary | null) => set({ location: place ? { id: place.id, name: place.name } : null })} />
        </div>
        <Field label={t("search.contract")}>
          {(id) => (
            <select id={id} className={select} value={value.contractType ?? ""} onChange={(event) => set({ contractType: (event.target.value || null) as OfferDraft["contractType"] })}>
              <option value="">—</option>
              {CONTRACT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`offer.contract.${type}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t("search.remote")}>
          {(id) => (
            <select id={id} className={select} value={value.remoteType ?? ""} onChange={(event) => set({ remoteType: (event.target.value || null) as OfferDraft["remoteType"] })}>
              <option value="">—</option>
              {REMOTE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`offer.remote.${type}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label={t("addOffer.fields.salaryMin")}>
          {(id) => (
            <input id={id} inputMode="numeric" className={`${input} h-9 text-sm tabular-nums text-fg`} value={value.salaryMin ?? ""} onChange={(event) => set({ salaryMin: number(event.target.value) })} />
          )}
        </Field>
        <Field label={t("addOffer.fields.salaryMax")} error={errors.get("salaryMax")}>
          {(id) => (
            <input id={id} inputMode="numeric" className={`${input} h-9 text-sm tabular-nums text-fg`} aria-invalid={errors.has("salaryMax")} value={value.salaryMax ?? ""} onChange={(event) => set({ salaryMax: number(event.target.value) })} />
          )}
        </Field>
        <Field label={t("addOffer.fields.currency")} error={errors.get("salaryCurrency")}>
          {(id) => (
            <input id={id} className={`${input} h-9 text-sm uppercase text-fg`} maxLength={3} aria-invalid={errors.has("salaryCurrency")} value={value.salaryCurrency ?? ""} onChange={(event) => set({ salaryCurrency: event.target.value.toUpperCase() || null })} />
          )}
        </Field>
        <Field label={t("addOffer.fields.period")}>
          {(id) => (
            <select id={id} className={select} value={value.salaryPeriod ?? ""} onChange={(event) => set({ salaryPeriod: (event.target.value || null) as OfferDraft["salaryPeriod"] })}>
              <option value="">—</option>
              {SALARY_PERIODS.map((period) => (
                <option key={period} value={period}>
                  {t(`offer.per.${period}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-[3fr_1fr]">
        <Field label={t("addOffer.fields.url")} error={errors.get("url")}>
          {(id) => (
            <input id={id} type="url" className={`${input} h-9 text-sm text-fg`} aria-invalid={errors.has("url")} value={value.url ?? ""} onChange={(event) => set({ url: event.target.value || null })} />
          )}
        </Field>
        <Field label={t("addOffer.fields.language")}>
          {(id) => (
            <select id={id} className={select} value={value.language ?? ""} onChange={(event) => set({ language: (event.target.value || null) as OfferDraft["language"] })}>
              <option value="">—</option>
              <option value="fr">{t("resume.languages.fr")}</option>
              <option value="en">{t("resume.languages.en")}</option>
            </select>
          )}
        </Field>
      </div>

      <Field label={t("offer.description")} error={errors.get("description")}>
        {(id) => (
          <textarea id={id}
            className={`${input} field-sizing-content min-h-48 resize-y py-2 text-sm leading-relaxed text-fg`}
            aria-invalid={errors.has("description")}
            value={value.description}
            onChange={(event) => set({ description: event.target.value })}
          />
        )}
      </Field>

      {error && (
        <p role="alert" className="rounded-control bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="flex h-9 items-center gap-2 rounded-control bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60">
          {pending && <Loader2 size={15} className="animate-spin" />}
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="h-9 rounded-control border border-border px-4 text-sm hover:bg-hover">
            {t("tabs.cancel")}
          </button>
        )}
      </div>
    </form>
  );
}
