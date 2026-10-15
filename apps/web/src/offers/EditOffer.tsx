import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { OfferDetail } from "@job/shared";
import { api } from "../api/client";
import { errorMessage } from "../lib/errors";
import { toast } from "../lib/toast";
import { OfferForm } from "./OfferForm";

// The creator of a private offer may edit it (FEATURE O5).
export default function EditOffer({ offer, onDone }: { offer: OfferDetail; onDone: () => void }) {
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
