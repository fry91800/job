import { useCallback, useEffect, useState } from "react";
import { emptyResumeContent, RESUME_LANGUAGES, type ResumeDetail, type ResumeListResponse } from "@job/shared";
import { api, errorText } from "../api";
import type { Navigate } from "../App";
import { JsonEditor } from "../JsonEditor";

export function ResumesPage({ navigate, refreshMe }: { navigate: Navigate; refreshMe: () => void }) {
  const [list, setList] = useState<ResumeListResponse["results"]>([]);
  const [message, setMessage] = useState("");
  const [language, setLanguage] = useState("fr");

  const load = useCallback(async () => {
    const result = await api<ResumeListResponse>("GET", "/api/resumes");
    if (result.ok) setList(result.data.results);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function after(result: Awaited<ReturnType<typeof api>>) {
    setMessage(errorText(result));
    refreshMe(); // the selection or a new guest changes the current user
    load();
  }

  async function createEmpty() {
    const result = await api<ResumeDetail>("POST", "/api/resumes", { language, content: emptyResumeContent("Prénom Nom") });
    await after(result);
    if (result.ok) navigate({ name: "resume", id: result.data.id });
  }

  // The body is the file itself (see POST /api/resumes/upload).
  async function upload(file: File) {
    const response = await fetch(`/api/resumes/upload?name=${encodeURIComponent(file.name.replace(/\.\w+$/, ""))}`, { method: "POST", body: file });
    const json = await response.json();
    setMessage(response.ok ? "Uploaded (placeholder parser: always the same resume)" : `${response.status} ${json.error?.code}: ${json.error?.message}`);
    refreshMe();
    load();
  }

  return (
    <div>
      <p>
        <select value={language} onChange={(event) => setLanguage(event.target.value)}>
          {RESUME_LANGUAGES.map((value) => <option key={value}>{value}</option>)}
        </select>{" "}
        <button onClick={createEmpty}>Create empty resume</button>{" "}
        Upload PDF/DOCX: <input type="file" accept=".pdf,.docx" onChange={(event) => event.target.files?.[0] && upload(event.target.files[0])} />
      </p>
      {message && <p className={message.match(/^\d{3} /) ? "error" : undefined}>{message}</p>}
      <table>
        <tbody>
          {list.map((resume) => (
            <tr key={resume.id}>
              <td>
                <a onClick={() => navigate({ name: "resume", id: resume.id })}>{resume.name}</a> {resume.isSelected && <strong>(selected)</strong>}
                <div className="muted">
                  {resume.language} · updated {new Date(resume.updatedAt).toLocaleString()}
                  {resume.translatedFrom && ` · translated from ${resume.translatedFrom.name}`}
                  {resume.hasSourceFile && <> · <a href={`/api/resumes/${resume.id}/source`}>original file</a></>}
                </div>
              </td>
              <td>
                {!resume.isSelected && <button onClick={async () => after(await api("POST", `/api/resumes/${resume.id}/select`))}>Select</button>}{" "}
                <button onClick={async () => confirm("Delete this resume?") && after(await api("DELETE", `/api/resumes/${resume.id}`))}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ResumePage({ id, refreshMe }: { id: string; refreshMe: () => void }) {
  const [resume, setResume] = useState<ResumeDetail | null>(null);
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("fr");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const result = await api<ResumeDetail>("GET", `/api/resumes/${id}`);
    setMessage(errorText(result));
    if (result.ok) {
      setResume(result.data);
      setName(result.data.name);
      setLanguage(result.data.language);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (!resume) return <p className="error">{message}</p>;

  async function save(content: unknown) {
    const result = await api<ResumeDetail>("PUT", `/api/resumes/${id}`, { name, language, content });
    setMessage(result.ok ? "Saved" : errorText(result));
    if (result.ok) {
      setResume(result.data);
      refreshMe(); // the selected resume's skills may have changed
    }
  }

  return (
    <div>
      <p>
        <label>Name <input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>Language{" "}
          <select value={language} onChange={(event) => setLanguage(event.target.value)}>
            {RESUME_LANGUAGES.map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
        {resume.isSelected && <strong>selected</strong>}
      </p>
      <p className="muted">
        Catalogue links (M2): skills [{resume.skillIds.join(", ")}] · occupations [{resume.occupationIds.join(", ")}]. Items without an id get one on save.
      </p>
      {message && <p className={message === "Saved" ? undefined : "error"}>{message}</p>}
      <JsonEditor key={resume.updatedAt} value={resume.content} onSave={save} />
    </div>
  );
}
