import { useCallback, useEffect, useState } from "react";
import { emptyResumeContent, RESUME_LANGUAGES, type ResumeDetail, type ResumeListResponse, type TranslateFieldResponse } from "@job/shared";
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

  // Translation (T1): proposes the existing translation when there is one.
  async function translate(id: string, language: string, force = false): Promise<void> {
    setMessage("Translating…");
    const result = await api<ResumeDetail>("POST", `/api/resumes/${id}/translations`, { language, force });
    if (result.ok) return navigate({ name: "resume", id: result.data.id });
    const existing = (result.error.details as { existingResumeId?: string } | undefined)?.existingResumeId;
    if (existing) {
      return confirm("A translation already exists. OK = open it, Cancel = create a new one")
        ? navigate({ name: "resume", id: existing })
        : translate(id, language, true);
    }
    await after(result);
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
    setMessage(response.ok ? "Uploaded and parsed: check the imported data" : `${response.status} ${json.error?.code}: ${json.error?.message}`);
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
        Upload PDF/DOCX (parsed by the AI): <input type="file" accept=".pdf,.docx" onChange={(event) => event.target.files?.[0] && upload(event.target.files[0])} />
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
                  {resume.translatedFrom?.changedSinceTranslation && <span className="error"> (original changed since)</span>}
                  {resume.hasSourceFile && <> · <a href={`/api/resumes/${resume.id}/source`}>original file</a></>}
                </div>
              </td>
              <td>
                {RESUME_LANGUAGES.filter((language) => language !== resume.language).map((language) => (
                  <button key={language} onClick={() => translate(resume.id, language)}>Translate to {language}</button>
                ))}{" "}
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
      {resume.translatedFrom && <TranslationTools resume={resume} />}
      <JsonEditor key={resume.updatedAt} value={resume.content} onSave={save} />
    </div>
  );
}

// Translated resume (T1): source changed banner, re-translate a field, source side by side.
function TranslationTools({ resume }: { resume: ResumeDetail }) {
  const source = resume.translatedFrom!;
  const [path, setPath] = useState("summary");
  const [result, setResult] = useState("");
  const [sourceContent, setSourceContent] = useState<unknown>(null);

  useEffect(() => {
    api<ResumeDetail>("GET", `/api/resumes/${source.id}`).then((response) => response.ok && setSourceContent(response.data.content));
  }, [source.id]);

  async function retranslate() {
    const response = await api<TranslateFieldResponse>("POST", `/api/resumes/${resume.id}/translate-field`, { path });
    setResult(response.ok ? response.data.text : errorText(response));
  }

  return (
    <fieldset>
      <legend>Translation of "{source.name}" — check the translation</legend>
      {source.changedSinceTranslation && (
        <p className="error">
          The original resume changed since this translation.{" "}
          <button onClick={async () => {
            const response = await api<ResumeDetail>("POST", `/api/resumes/${source.id}/translations`, { language: resume.language, force: true });
            setResult(response.ok ? `New translation created: ${response.data.name} (see the resume list)` : errorText(response));
          }}>Translate again</button>
        </p>
      )}
      <p>
        Re-translate field (path, e.g. summary, workExperience[id=…].responsibilities[id=…].text):{" "}
        <input size={50} value={path} onChange={(event) => setPath(event.target.value)} /> <button onClick={retranslate}>Re-translate</button>
      </p>
      {result && <pre>{result}</pre>}
      <details>
        <summary>Source resume (side by side reference)</summary>
        <pre>{JSON.stringify(sourceContent, null, 2)}</pre>
      </details>
    </fieldset>
  );
}
