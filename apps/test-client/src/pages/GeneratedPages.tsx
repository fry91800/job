import { useCallback, useEffect, useState } from "react";
import type { GeneratedResumeDetail, GeneratedResumeListResponse, PhotoListResponse, TemplateListResponse } from "@job/shared";
import { api, errorText } from "../api";
import type { Navigate } from "../App";
import { JsonEditor } from "../JsonEditor";

export function GeneratedList({ offerId, navigate }: { offerId?: string; navigate: Navigate }) {
  const [list, setList] = useState<GeneratedResumeListResponse["results"]>([]);

  useEffect(() => {
    api<GeneratedResumeListResponse>("GET", `/api/generated-resumes${offerId ? `?offerId=${offerId}` : ""}`).then(
      (result) => result.ok && setList(result.data.results),
    );
  }, [offerId]);

  if (list.length === 0) return <p className="muted">No generated resumes.</p>;
  return (
    <table>
      <tbody>
        {list.map((item) => (
          <tr key={item.id}>
            <td>
              <a onClick={() => navigate({ name: "generatedResume", id: item.id })}>{new Date(item.createdAt).toLocaleString()}</a>
              {!offerId && <> — <a onClick={() => navigate({ name: "offer", id: item.offer.id })}>{item.offer.title}</a> ({item.offer.companyName ?? "—"})</>}
            </td>
            <td className="muted">
              {item.resume?.name ?? "deleted resume"} · {item.language} · {item.template.name} · {item.modified ? item.modifierStrength : "not modified"} · match{" "}
              {item.matchScore ?? "n/a"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function GeneratedPage({ navigate }: { navigate: Navigate }) {
  return <GeneratedList navigate={navigate} />;
}

export function GeneratedResumePage({ id, navigate }: { id: string; navigate: Navigate }) {
  const [item, setItem] = useState<GeneratedResumeDetail | null>(null);
  const [templates, setTemplates] = useState<TemplateListResponse["results"]>([]);
  const [photos, setPhotos] = useState<PhotoListResponse["results"]>([]);
  const [message, setMessage] = useState("");
  const [version, setVersion] = useState(0); // reloads the preview iframe

  const load = useCallback(async () => {
    const result = await api<GeneratedResumeDetail>("GET", `/api/generated-resumes/${id}`);
    setMessage(errorText(result));
    setItem(result.ok ? result.data : null);
    setVersion((value) => value + 1);
  }, [id]);

  useEffect(() => {
    load();
    api<TemplateListResponse>("GET", "/api/templates").then((result) => result.ok && setTemplates(result.data.results));
    api<PhotoListResponse>("GET", "/api/photos").then((result) => result.ok && setPhotos(result.data.results));
  }, [load]);

  async function patch(body: object) {
    const result = await api("PATCH", `/api/generated-resumes/${id}`, body);
    setMessage(errorText(result));
    if (result.ok) load();
  }

  async function remove() {
    if (!confirm("Delete this generated resume?")) return;
    const result = await api("DELETE", `/api/generated-resumes/${id}`);
    if (result.ok) navigate({ name: "generated" });
    else setMessage(errorText(result));
  }

  if (!item) return <p className="error">{message}</p>;

  return (
    <div>
      <p>
        For <a onClick={() => navigate({ name: "offer", id: item.offer.id })}>{item.offer.title}</a> ({item.offer.companyName ?? "—"}) · match{" "}
        {item.matchScore ?? "n/a"} · {item.modified ? `modified (${item.modifierStrength})` : "not modified"}
      </p>
      <p>
        Template{" "}
        <select value={item.template.id} onChange={(event) => patch({ templateId: Number(event.target.value) })}>
          {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
        </select>{" "}
        Photo{" "}
        <select value={item.photoId ?? ""} onChange={(event) => patch({ photoId: event.target.value || null })}>
          <option value="">no photo</option>
          {item.photoId && !photos.some((photo) => photo.id === item.photoId) && <option value={item.photoId}>(deleted photo)</option>}
          {photos.map((photo) => <option key={photo.id} value={photo.id}>{photo.name}</option>)}
        </select>{" "}
        <a href={`/api/generated-resumes/${id}/pdf`}>Download PDF</a>{" "}
        <a href={`/api/generated-resumes/${id}/html`} target="_blank">Open HTML</a>{" "}
        <button onClick={remove}>Delete</button>
      </p>
      {message && <p className="error">{message}</p>}
      <iframe key={version} title="preview" src={`/api/generated-resumes/${id}/html`} style={{ width: 794, height: 600, border: "1px solid #ccc" }} />
      <h3>Generated content (M3 edit)</h3>
      <JsonEditor key={item.updatedAt} value={item.generatedContent} onSave={(generatedContent) => patch({ generatedContent })} />
    </div>
  );
}
