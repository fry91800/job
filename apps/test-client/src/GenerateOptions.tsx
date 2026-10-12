import { useEffect, useState } from "react";
import { MODIFIER_SECTIONS, MODIFIER_STRENGTHS, type ModifierConfig, type ModifierStrength, type Settings } from "@job/shared";
import { api } from "./api";

export type GenerateRequestOptions = {
  modifierEnabled: boolean;
  modifierStrength: ModifierStrength;
  modifierConfig: ModifierConfig;
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

  useEffect(() => {
    api<Settings>("GET", "/api/settings").then((result) => {
      if (result.ok) {
        const { modifierEnabled, modifierStrength, modifierConfig } = result.data;
        setOptions((current) => ({ ...current, modifierEnabled, modifierStrength, modifierConfig }));
      }
    });
  }, []);

  const set = (change: Partial<GenerateRequestOptions>) => setOptions((current) => ({ ...current, ...change }));

  return (
    <div>
      <label><input type="checkbox" checked={options.modifierEnabled} onChange={(event) => set({ modifierEnabled: event.target.checked })} /> AI modifier</label>
      {options.modifierEnabled && (
        <>
          <select value={options.modifierStrength} onChange={(event) => set({ modifierStrength: event.target.value as ModifierStrength })}>
            {MODIFIER_STRENGTHS.map((strength) => <option key={strength}>{strength}</option>)}
          </select>{" "}
          {MODIFIER_SECTIONS.map((section) => (
            <label key={section}>
              <input
                type="checkbox"
                checked={options.modifierConfig[section] ?? false}
                onChange={(event) => set({ modifierConfig: { ...options.modifierConfig, [section]: event.target.checked } })}
              />
              {section}
            </label>
          ))}
        </>
      )}{" "}
      <label><input type="checkbox" checked={options.remember} onChange={(event) => set({ remember: event.target.checked })} /> remember</label>{" "}
      <button onClick={() => onGenerate(options)}>Generate with selected resume</button>
    </div>
  );
}
