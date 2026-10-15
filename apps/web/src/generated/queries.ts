import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GeneratedResumeDetail, GeneratedResumeListResponse, ModifierConfig, ModifierStrength, SettingsResponse, TemplateListResponse } from "@job/shared";
import { api, ApiError } from "../api/client";
import { keys } from "../api/queries";

// Generated resumes (FEATURE M1, M3, M4).

export const generatedKeys = { list: ["generated"] as const, one: (id: string) => ["generated", id] as const };

export function useGeneratedList() {
  return useQuery({ queryKey: generatedKeys.list, queryFn: ({ signal }) => api<GeneratedResumeListResponse>("GET", "/api/generated-resumes", { signal }) });
}

export function useGenerated(id: string) {
  return useQuery({ queryKey: generatedKeys.one(id), queryFn: ({ signal }) => api<GeneratedResumeDetail>("GET", `/api/generated-resumes/${id}`, { signal }) });
}

export function useTemplates() {
  return useQuery({ queryKey: ["templates"], queryFn: ({ signal }) => api<TemplateListResponse>("GET", "/api/templates", { signal }), staleTime: 30 * 60_000 });
}

// Visitors without a session have no settings yet: the defaults (FEATURE S1).
export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: async ({ signal }) => {
      try {
        return await api<SettingsResponse>("GET", "/api/settings", { signal });
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
  });
}

export type GenerateInput = {
  offerId: string;
  resumeId?: string;
  templateId?: number;
  modifierEnabled?: boolean;
  modifierStrength?: ModifierStrength;
  modifierConfig?: ModifierConfig;
  remember?: boolean;
  ignoreLanguageMismatch?: boolean;
};

// A generation saves the offer (O3) and adds to its list of generated resumes.
export function useGenerate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: GenerateInput) => api<GeneratedResumeDetail>("POST", "/api/generated-resumes", { body: input }),
    onSuccess: (detail) => {
      client.setQueryData(generatedKeys.one(detail.id), detail);
      void client.invalidateQueries({ queryKey: generatedKeys.list, exact: true });
      void client.invalidateQueries({ queryKey: ["offer", detail.offer.id] });
      void client.invalidateQueries({ queryKey: ["search"] });
      void client.invalidateQueries({ queryKey: ["settings"] });
      void client.invalidateQueries({ queryKey: keys.me });
    },
  });
}

// Decisions, template, photo: the server answers with the updated resume.
function useUpdate(id: string) {
  const client = useQueryClient();
  return (detail: GeneratedResumeDetail) => {
    client.setQueryData(generatedKeys.one(id), detail);
    void client.invalidateQueries({ queryKey: generatedKeys.list, exact: true });
  };
}

export function useDecide(id: string) {
  const update = useUpdate(id);
  const client = useQueryClient();
  return useMutation({
    mutationFn: (decisions: { id: string; status: "accepted" | "rejected" }[]) => api<GeneratedResumeDetail>("PATCH", `/api/generated-resumes/${id}/changes`, { body: { decisions } }),
    // The decision shows at once (FRONTEND.md §3); the content follows the server's answer.
    onMutate: (decisions) =>
      client.setQueryData<GeneratedResumeDetail>(generatedKeys.one(id), (detail) =>
        detail && { ...detail, changes: detail.changes.map((change) => ({ ...change, status: decisions.find((decision) => decision.id === change.id)?.status ?? change.status })) },
      ),
    onSuccess: update,
    onError: () => client.invalidateQueries({ queryKey: generatedKeys.one(id) }),
  });
}

export function useUpdateGenerated(id: string) {
  const update = useUpdate(id);
  return useMutation({
    mutationFn: (change: { templateId?: number; photoId?: string | null }) => api<GeneratedResumeDetail>("PATCH", `/api/generated-resumes/${id}`, { body: change }),
    onSuccess: update,
  });
}

export function useDeleteGenerated() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>("DELETE", `/api/generated-resumes/${id}`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: generatedKeys.list, exact: true });
      void client.invalidateQueries({ queryKey: ["offer"] });
    },
  });
}
