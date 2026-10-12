import { useEffect, useState } from "react";
import { MODIFIER_SECTIONS, MODIFIER_STRENGTHS, UI_LANGUAGES, type Settings, type TemplateListResponse } from "@job/shared";
import { api, errorText } from "../api";

export function SettingsPage({ refreshMe }: { refreshMe: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [templates, setTemplates] = useState<TemplateListResponse["results"]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    api<TemplateListResponse>("GET", "/api/templates").then((result) => result.ok && setTemplates(result.data.results));
    api<Settings>("GET", "/api/settings").then((result) => {
      if (result.ok) setSettings(result.data);
      else setMessage("No user yet: changing a setting creates a guest.");
    });
  }, []);

  async function update(change: Partial<Settings>) {
    const result = await api<Settings>("PATCH", "/api/settings", change);
    setMessage(errorText(result));
    if (result.ok) setSettings(result.data);
    refreshMe();
  }

  const current: Settings = settings ?? { modifierEnabled: false, modifierStrength: "soft", modifierConfig: {}, templateId: 1, uiLanguage: "fr" };

  return (
    <div>
      {message && <p className={message.match(/^\d{3} /) ? "error" : "muted"}>{message}</p>}
      <fieldset>
        <legend>Template (S2)</legend>
        {templates.map((template) => (
          <label key={template.id}>
            <input type="radio" checked={current.templateId === template.id} onChange={() => update({ templateId: template.id })} />
            {template.name} <span className="muted">({template.rendererKey}{template.supportsPhoto ? ", photo" : ""})</span>
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>Resume modifier (S1) — AI not available yet, generation needs it off</legend>
        <label><input type="checkbox" checked={current.modifierEnabled} onChange={(event) => update({ modifierEnabled: event.target.checked })} /> Enabled</label>
        <label>Strength{" "}
          <select value={current.modifierStrength} onChange={(event) => update({ modifierStrength: event.target.value as Settings["modifierStrength"] })}>
            {MODIFIER_STRENGTHS.map((strength) => <option key={strength}>{strength}</option>)}
          </select>
        </label>
        <div>
          Sections:{" "}
          {MODIFIER_SECTIONS.map((section) => (
            <label key={section}>
              <input
                type="checkbox"
                checked={current.modifierConfig[section] ?? false}
                onChange={(event) => update({ modifierConfig: { ...current.modifierConfig, [section]: event.target.checked } })}
              />
              {section}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>UI language</legend>
        <select value={current.uiLanguage} onChange={(event) => update({ uiLanguage: event.target.value })}>
          {UI_LANGUAGES.map((language) => <option key={language}>{language}</option>)}
        </select>
      </fieldset>
    </div>
  );
}
