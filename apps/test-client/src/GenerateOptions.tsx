import { useEffect, useState } from "react";
import { MODIFIER_STRENGTHS, type ModifierConfig, type ModifierStrength, type SettingsResponse } from "@job/shared";
import { api } from "./api";
import { ModifierSections } from "./ModifierSections";

export type GenerateRequestOptions = {
  modifierEnabled: boolean;
  modifierStrength: ModifierStrength;
  modifierConfig?: ModifierConfig; // only when users choose the sections
  remember: boolean;
};

// Generation options (M1), pre-filled from the settings, overridable once.
export function GenerateOptions({ onGenerate }: { onGenerate: (options: GenerateRequestOptions) => void }) {
  const [options, setOptions] = useState<GenerateRequestOptions>({
    modifierEnabled: false,
    modifierStrength: "soft",
    modifierConfig: { summary: true, skills: true },
    remember: false,
  });
  const [settings, setSettings] = useState<SettingsResponse | null>(null);

  useEffect(() => {
    api<SettingsResponse>("GET", "/api/settings").then((result) => {
      if (result.ok) {
        const { modifierEnabled, modifierStrength, modifierConfig } = result.data;
        setSettings(result.data);
        setOptions((current) => ({ ...current, modifierEnabled, modifierStrength, modifierConfig }));
      }
    });
  }, []);

  // When the strength decides, the sections aren't sent.
  const request = (): GenerateRequestOptions => (settings && !settings.modifierSectionChoice ? { ...options, modifierConfig: undefined } : options);

  const set = (change: Partial<GenerateRequestOptions>) => setOptions((current) => ({ ...current, ...change }));

  return (
    <div>
      <label><input type="checkbox" checked={options.modifierEnabled} onChange={(event) => set({ modifierEnabled: event.target.checked })} /> AI modifier</label>
      {options.modifierEnabled && (
        <>
          <select value={options.modifierStrength} onChange={(event) => set({ modifierStrength: event.target.value as ModifierStrength })}>
            {MODIFIER_STRENGTHS.map((strength) => <option key={strength}>{strength}</option>)}
          </select>{" "}
          <ModifierSections settings={settings} strength={options.modifierStrength} config={options.modifierConfig ?? {}} onChange={(modifierConfig) => set({ modifierConfig })} />
        </>
      )}{" "}
      <label><input type="checkbox" checked={options.remember} onChange={(event) => set({ remember: event.target.checked })} /> remember</label>{" "}
      <button onClick={() => onGenerate(request())}>Generate with selected resume</button>
    </div>
  );
}
