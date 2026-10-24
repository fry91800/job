import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ResumeContent, ResumeDetail, ResumeLanguage, ResumeListResponse, TranslateFieldResponse } from "@job/shared";
import { api } from "../api/client";
import { keys } from "../api/queries";
import { track } from "../lib/analytics";

// Resumes (FEATURE R1–R5, T1). The selected resume drives the match % (O4): anything that
// changes it refreshes the current user (`me`), which holds its skills.

export const resumeKeys = { list: ["resumes"] as const, one: (id: string) => ["resume", id] as const };

export function useResumes() {
  return useQuery({ queryKey: resumeKeys.list, queryFn: ({ signal }) => api<ResumeListResponse>("GET", "/api/resumes", { signal }) });
}

export function useResume(id: string | null) {
  return useQuery({
    queryKey: resumeKeys.one(id ?? ""),
    queryFn: ({ signal }) => api<ResumeDetail>("GET", `/api/resumes/${id}`, { signal }),
    enabled: id !== null,
  });
}

// A created or saved resume is put in the cache (its detail and the list) right away, so
// it can be opened before the list is fetched again.
function useAfterChange() {
  const client = useQueryClient();
  return (resume?: ResumeDetail) => {
    if (resume) {
      client.setQueryData(resumeKeys.one(resume.id), resume);
      const { content: _content, skillIds: _skills, occupationIds: _occupations, createdAt: _created, ...item } = resume;
      client.setQueryData<ResumeListResponse>(resumeKeys.list, (list) =>
        list && { results: list.results.some((other) => other.id === item.id) ? list.results.map((other) => (other.id === item.id ? item : other)) : [item, ...list.results] },
      );
    }
    void client.invalidateQueries({ queryKey: resumeKeys.list });
    void client.invalidateQueries({ queryKey: keys.me });
  };
}

export function useUploadResume() {
  const after = useAfterChange();
  return useMutation({
    mutationFn: (file: File) => api<ResumeDetail>("POST", "/api/resumes/upload", { file }),
    onSuccess: () => {
      track("resume_upload");
      after();
    },
  });
}

export function useCreateResume() {
  const after = useAfterChange();
  return useMutation({
    mutationFn: (input: { language: ResumeLanguage; content: ResumeContent; name?: string }) => api<ResumeDetail>("POST", "/api/resumes", { body: input }),
    onSuccess: () => {
      track("resume_create");
      after();
    },
  });
}

export function useSaveResume(id: string) {
  const after = useAfterChange();
  return useMutation({
    mutationFn: (input: { name: string; language: string; content: ResumeContent }) => api<ResumeDetail>("PUT", `/api/resumes/${id}`, { body: input }),
    onSuccess: after,
  });
}

export function useSelectResume() {
  const after = useAfterChange();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>("POST", `/api/resumes/${id}/select`),
    // Shown at once (FRONTEND.md §3).
    onMutate: (id) =>
      client.setQueryData<ResumeListResponse>(resumeKeys.list, (list) => list && { results: list.results.map((item) => ({ ...item, isSelected: item.id === id })) }),
    onSettled: () => after(),
  });
}

export function useDeleteResume() {
  const after = useAfterChange();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>("DELETE", `/api/resumes/${id}`),
    onSuccess: (_result, id) => {
      client.setQueryData<ResumeListResponse>(resumeKeys.list, (list) => list && { results: list.results.filter((item) => item.id !== id) });
      after();
    },
  });
}

export function useTranslateResume() {
  const after = useAfterChange();
  return useMutation({
    mutationFn: (input: { id: string; language: ResumeLanguage; force?: boolean }) =>
      api<ResumeDetail>("POST", `/api/resumes/${input.id}/translations`, { body: { language: input.language, force: input.force } }),
    onSuccess: (_detail, input) => {
      track("resume_translate", { language: input.language });
      after();
    },
  });
}

export const translateField = (id: string, path: string) => api<TranslateFieldResponse>("POST", `/api/resumes/${id}/translate-field`, { body: { path } });
