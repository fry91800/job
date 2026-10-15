import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Briefcase, Building2, ChevronDown, Clock, ExternalLink, Lock, MapPin, Pencil, Sparkles, Star, Wallet } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { computeMatch, SAVED_OFFER_STATUSES, type OfferDetail, type SavedOfferStatus } from "@job/shared";
import { api, ApiError } from "../api/client";
import { useMe, useOffer, useSavedOfferMutation } from "../api/queries";
import { useGenerateDialog } from "../generated/GenerateDialog";
import { MenuChoice, MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger } from "../layout/menu";
import { errorMessage } from "../lib/errors";
import { formatAge, formatDate, formatSalary } from "../lib/format";
import { toast } from "../lib/toast";
import { useTabsStore } from "../tabs/store";
import { useWorkspace } from "../tabs/workspace";
import type { TabViewProps } from "../views/registry";
import { Markdown } from "./Markdown";
import { MatchBadge } from "./MatchBadge";
import { OfferForm } from "./OfferForm";

// Offer tab (FRONTEND.md §2.3, FEATURE O2): the offer, its match with the selected resume
// (O4), saving and tracking (O3). Saving or tracking keeps a preview tab open.

function Fact({ icon: Icon, children }: { icon: typeof MapPin; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-fg-muted">
      <Icon size={14} className="shrink-0 text-fg-subtle" />
      {children}
    </span>
  );
}

function SaveControls({ offer, onUsed }: { offer: OfferDetail; onUsed: () => void }) {
  const { t } = useTranslation();
  const mutation = useSavedOfferMutation(offer.id);
  const button = "flex h-8 items-center gap-1.5 rounded-control border border-border px-3 text-sm transition-colors duration-150 hover:bg-hover";
  if (!offer.saved) {
    return (
      <button
        type="button"
        className={button}
        onClick={() => {
          onUsed();
          mutation.mutate({ status: "saved" });
        }}
      >
        <Star size={15} /> {t("offer.save")}
      </button>
    );
  }
  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <button type="button" className={`${button} border-warning/40 data-[state=open]:bg-hover`}>
          <Star size={15} className="fill-warning text-warning" />
          {t(`offer.status.${offer.saved.status}`)}
          <ChevronDown size={14} className="text-fg-subtle" />
        </button>
      </MenuTrigger>
      <MenuContent>
        <MenuChoice
          value={offer.saved.status}
          options={SAVED_OFFER_STATUSES.map((status) => ({ value: status, label: t(`offer.status.${status}`) }))}
          onChange={(status: SavedOfferStatus) => {
            onUsed();
            mutation.mutate({ status });
          }}
        />
        <MenuSeparator />
        <MenuItem onSelect={() => mutation.mutate({ unsave: true })}>{t("offer.unsave")}</MenuItem>
      </MenuContent>
    </MenuRoot>
  );
}

function MatchPanel({ offer }: { offer: OfferDetail }) {
  const { t } = useTranslation();
  const { open } = useWorkspace();
  const resume = useMe().data?.user?.selectedResume ?? null;
  if (!resume) {
    return (
      <p className="text-sm text-fg-muted">
        {t("offer.matchNoResume")}{" "}
        <button type="button" onClick={() => open({ kind: "resumes" })} className="text-accent hover:underline">
          {t("welcome.upload")}
        </button>
      </p>
    );
  }
  const match = computeMatch({ skillIds: offer.skills.map((skill) => skill.id), occupationIds: offer.occupations.map((item) => item.id) }, resume);
  if (match.score === null) return <p className="text-sm text-fg-muted">{t("offer.matchNone")}</p>;
  const names = (ids: number[]) => offer.skills.filter((skill) => ids.includes(skill.id));
  return (
    <div className="flex flex-col gap-3">
      <MatchBadge score={match.score} large />
      {match.sharesOccupation && <p className="text-sm text-fg-muted">{t("offer.sharesOccupation")}</p>}
      {[
        { title: t("offer.matched"), skills: names(match.matchedSkillIds), tone: "border-success/40 text-success" },
        { title: t("offer.missing"), skills: names(match.missingSkillIds), tone: "border-border text-fg-muted" },
      ]
        .filter((group) => group.skills.length > 0)
        .map((group) => (
          <div key={group.title} className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-subtle">{group.title}</span>
            <div className="flex flex-wrap gap-1.5">
              {group.skills.map((skill) => (
                <span key={skill.id} className={`rounded-full border px-2 py-0.5 text-xs ${group.tone}`}>
                  {skill.name}
                </span>
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}

function OfferSkeleton() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-8 py-8">
      <div className="h-7 w-2/3 animate-pulse rounded-control bg-hover" />
      <div className="h-4 w-1/3 animate-pulse rounded-control bg-hover" />
      <div className="mt-4 h-4 w-full animate-pulse rounded-control bg-hover" />
      <div className="h-4 w-5/6 animate-pulse rounded-control bg-hover" />
      <div className="h-4 w-4/6 animate-pulse rounded-control bg-hover" />
    </div>
  );
}

// The creator of a private offer may edit it (FEATURE O5).
function EditOffer({ offer, onDone }: { offer: OfferDetail; onDone: () => void }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: (draft: object) => api<OfferDetail>("PUT", `/api/user-offers/${offer.id}`, { body: draft }),
    onSuccess: (updated) => {
      client.setQueriesData<OfferDetail>({ queryKey: ["offer", offer.id] }, () => updated);
      void client.invalidateQueries({ queryKey: ["offer", offer.id] });
      void client.invalidateQueries({ queryKey: ["saved-offers"] });
      toast(t("addOffer.updated"));
      onDone();
    },
  });
  return (
    <OfferForm
      initial={{
        title: offer.title,
        companyName: offer.companyName,
        description: offer.description,
        language: (offer.language as "fr" | "en" | null) ?? null,
        url: offer.url,
        locationId: offer.location?.id ?? null,
        location: offer.location ? { id: offer.location.id, name: offer.location.name } : null,
        remoteType: offer.remoteType,
        contractType: offer.contractType,
        salaryMin: offer.salary?.min ?? null,
        salaryMax: offer.salary?.max ?? null,
        salaryCurrency: offer.salary?.currency ?? null,
        salaryPeriod: offer.salary?.period ?? null,
      }}
      submitLabel={t("resume.save")}
      pending={save.isPending}
      error={save.error ? errorMessage(t, save.error) : null}
      onSubmit={(draft) => save.mutate(draft)}
      onCancel={onDone}
    />
  );
}

export default function OfferView({ tab }: TabViewProps) {
  const { t, i18n } = useTranslation();
  const { open, keep } = useWorkspace();
  const offer = useOffer(tab.id!, i18n.language);
  const [editing, setEditing] = useState(false);
  const title = offer.data?.title;

  // The tab shows the offer's title.
  useEffect(() => {
    if (title) useTabsStore.getState().update(tab.key, { title });
  }, [title, tab.key]);

  if (offer.isPending) return <OfferSkeleton />;
  if (offer.isError) {
    const missing = offer.error instanceof ApiError && offer.error.status === 404;
    return <p className="mx-auto max-w-3xl px-8 py-10 text-fg-muted">{missing ? t("offer.notFound") : t("offer.error")}</p>;
  }

  const data = offer.data;
  if (editing) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-8">
        <EditOffer offer={data} onDone={() => setEditing(false)} />
      </div>
    );
  }
  const salary = formatSalary(data.salary, i18n.language, t);
  const age = formatAge(data.publishedAt, i18n.language);
  const card = "rounded-box border border-border bg-surface p-4";

  return (
    <article className="mx-auto flex max-w-3xl flex-col gap-6 px-8 py-8">
      {data.closedAt && (
        <p className="flex items-center gap-2 rounded-box border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <AlertTriangle size={16} className="text-warning" /> {t("offer.closed")}
        </p>
      )}
      {!data.isPublic && (
        <p className="flex items-center gap-2 rounded-box border border-border bg-hover px-3 py-2 text-sm text-fg-muted">
          <Lock size={14} /> {t("offer.private")}
        </p>
      )}

      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold leading-tight tracking-tight">{data.title}</h1>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
          {data.companyName && <Fact icon={Building2}>{data.companyName}</Fact>}
          {data.location && <Fact icon={MapPin}>{data.location.name}</Fact>}
          {(data.contractType || data.remoteType) && (
            <Fact icon={Briefcase}>
              {[data.contractType && t(`offer.contract.${data.contractType}`), data.remoteType && t(`offer.remote.${data.remoteType}`)].filter(Boolean).join(" · ")}
            </Fact>
          )}
          {salary && <Fact icon={Wallet}>{salary}</Fact>}
          {age && data.publishedAt && (
            <span title={formatDate(data.publishedAt, i18n.language)}>
              <Fact icon={Clock}>{t("offer.published", { age })}</Fact>
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <SaveControls offer={data} onUsed={() => keep(tab.key)} />
          <button
            type="button"
            onClick={() => useGenerateDialog.getState().open({ id: data.id, title: data.title })}
            className="flex h-8 items-center gap-1.5 rounded-control bg-accent px-3 text-sm font-medium text-accent-fg transition-colors duration-150 hover:bg-accent-hover"
          >
            <Sparkles size={15} /> {t("offer.generate")}
          </button>
          {data.isOwn && !data.isPublic && (
            <button
              type="button"
              onClick={() => {
                keep(tab.key);
                setEditing(true);
              }}
              className="flex h-8 items-center gap-1.5 rounded-control px-3 text-sm text-fg-muted transition-colors hover:bg-hover hover:text-fg"
            >
              <Pencil size={15} /> {t("addOffer.edit")}
            </button>
          )}
          {data.url && (
            <a
              href={data.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="flex h-8 items-center gap-1.5 rounded-control px-3 text-sm text-fg-muted transition-colors hover:bg-hover hover:text-fg"
            >
              <ExternalLink size={15} /> {t("offer.openOriginal")}
            </a>
          )}
        </div>
      </header>

      <section className={card}>
        <h2 className="mb-3 text-sm font-semibold">{t("offer.match")}</h2>
        <MatchPanel offer={data} />
      </section>

      {data.skills.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">{t("offer.skills")}</h2>
          <div className="flex flex-wrap gap-1.5">
            {data.skills.map((skill) => (
              <span key={skill.id} className="rounded-full bg-hover px-2.5 py-0.5 text-xs text-fg-muted">
                {skill.name}
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">{t("offer.description")}</h2>
        <Markdown text={data.description} />
      </section>

      {data.generatedResumes.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">{t("offer.generatedResumes")}</h2>
          <ul className="flex flex-col">
            {data.generatedResumes.map((resume) => (
              <li key={resume.id}>
                <button
                  type="button"
                  onClick={() => open({ kind: "generated", id: resume.id })}
                  className="flex w-full items-center gap-3 rounded-control px-2 py-1.5 text-left text-sm transition-colors hover:bg-hover"
                >
                  <Sparkles size={14} className="text-accent" />
                  <span>{formatDate(resume.createdAt, i18n.language)}</span>
                  <span className="text-xs uppercase text-fg-subtle">{resume.language}</span>
                  {resume.matchScore !== null && <MatchBadge score={resume.matchScore} />}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
