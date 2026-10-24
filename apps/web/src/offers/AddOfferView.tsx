import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ClipboardPaste, Link2, Loader2, Plus, Sparkles } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { OfferDetail, OfferDraft, OfferExtractResponse } from "@job/shared";
import { api, ApiError } from "../api/client";
import { keys } from "../api/queries";
import { errorMessage } from "../lib/errors";
import { track } from "../lib/analytics";
import { toast } from "../lib/toast";
import { useWorkspace } from "../tabs/workspace";
import { OfferForm, type OfferFormValue } from "./OfferForm";

// Add an offer found elsewhere (FEATURE O5): its address or its text; the AI fills in the
// fields, the user checks them, the offer is saved privately (and in saved offers). An
// address already known opens that offer. A page that can't be read (login wall, bot
// protection) asks for the text instead.

type Mode = "url" | "text";

export default function AddOfferView() {
  const { t } = useTranslation();
  const { open } = useWorkspace();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6 sm:px-8 sm:py-8">
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Plus size={20} className="text-accent" /> {t("search.addOffer")}
        </h1>
        <p className="text-sm text-fg-muted">{t("addOffer.intro")}</p>
      </header>
      <AddOfferFlow onSaved={(offerId) => open({ kind: "offer", id: offerId })} />
    </div>
  );
}

// The address or text, then the fields to check, then saved. Also used by the guided path
// (offers/TailorView). `onSaved` gets the saved offer, or the known offer with that address.
export function AddOfferFlow({ onSaved }: { onSaved: (offerId: string) => void }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [mode, setMode] = useState<Mode>("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<OfferFormValue | null>(null);
  const [formKey, setFormKey] = useState(0);

  const extract = useMutation({ mutationFn: (body: { url: string } | { text: string }) => api<OfferExtractResponse>("POST", "/api/user-offers/extract", { body }) });
  const save = useMutation({
    mutationFn: (value: OfferDraft) => api<OfferDetail>("POST", "/api/user-offers", { body: value }),
    onSuccess: () => {
      track("offer_add");
      void client.invalidateQueries({ queryKey: ["saved-offers"] });
      void client.invalidateQueries({ queryKey: keys.me });
    },
  });

  const onExtract = async (event: FormEvent) => {
    event.preventDefault();
    setNotice(null);
    try {
      const result = await extract.mutateAsync(mode === "url" ? { url: url.trim() } : { text });
      if ("existingOfferId" in result) {
        toast(t("addOffer.exists"), "info");
        void client.invalidateQueries({ queryKey: ["saved-offers"] });
        onSaved(result.existingOfferId);
        return;
      }
      setDraft({ ...result.draft, url: result.draft.url ?? (mode === "url" ? url.trim() : null), location: result.location ? { id: result.location.id, name: result.location.name } : null });
      setFormKey((key) => key + 1);
    } catch (error) {
      // The page can't be read: paste its text instead (FEATURE O5).
      if (error instanceof ApiError && error.code === "page_unavailable") {
        setMode("text");
        setNotice(t("addOffer.pasteInstead"));
      }
    }
  };

  const reset = () => {
    setDraft(null);
    setUrl("");
    setText("");
    extract.reset();
    save.reset();
  };

  const tab = (value: Mode, icon: typeof Link2, label: string) => {
    const Icon = icon;
    return (
      <button
        type="button"
        role="tab"
        aria-selected={mode === value}
        onClick={() => setMode(value)}
        className={`flex h-8 items-center gap-1.5 rounded-control px-3 text-sm transition-colors ${mode === value ? "bg-surface font-medium shadow-float" : "text-fg-muted hover:text-fg"}`}
      >
        <Icon size={14} /> {label}
      </button>
    );
  };

  return (
    <>
      {!draft ? (
        <form onSubmit={onExtract} className="flex flex-col gap-3">
          <div role="tablist" className="flex self-start rounded-box bg-hover p-1">
            {tab("url", Link2, t("addOffer.byUrl"))}
            {tab("text", ClipboardPaste, t("addOffer.byText"))}
          </div>
          {notice && <p className="rounded-control border border-warning/40 bg-warning/10 px-3 py-2 text-sm">{notice}</p>}
          {mode === "url" ? (
            <input
              type="url"
              autoFocus
              aria-label={t("addOffer.urlLabel")}
              placeholder="https://…"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              className="h-10 rounded-control border border-border bg-bg px-3 outline-none focus:border-accent"
            />
          ) : (
            <textarea
              autoFocus
              aria-label={t("addOffer.textLabel")}
              placeholder={t("addOffer.textPlaceholder")}
              value={text}
              onChange={(event) => setText(event.target.value)}
              className="min-h-56 resize-y rounded-control border border-border bg-bg px-3 py-2 text-sm leading-relaxed outline-none focus:border-accent"
            />
          )}
          {extract.error && !(extract.error instanceof ApiError && extract.error.code === "page_unavailable") && (
            <p role="alert" className="rounded-control bg-danger/10 px-3 py-2 text-sm text-danger">
              {errorMessage(t, extract.error)}
            </p>
          )}
          <button
            type="submit"
            disabled={extract.isPending || (mode === "url" ? !url.trim() : text.trim().length < 20)}
            className="flex h-9 items-center gap-2 self-start rounded-control bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-50"
          >
            {extract.isPending ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            {extract.isPending ? t("addOffer.reading") : t("addOffer.extract")}
          </button>
          <p className="text-xs text-fg-subtle">{t("addOffer.privacy")}</p>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="rounded-box border border-accent/30 bg-accent-soft px-3 py-2 text-sm">{t("addOffer.check")}</p>
          <OfferForm
            key={formKey}
            initial={draft}
            submitLabel={t("addOffer.save")}
            pending={save.isPending}
            error={save.error ? errorMessage(t, save.error) : null}
            onCancel={reset}
            onSubmit={(value) =>
              save.mutate(value, {
                onSuccess: (offer) => {
                  toast(t("addOffer.saved"));
                  reset();
                  onSaved(offer.id);
                },
              })
            }
          />
        </div>
      )}
    </>
  );
}
