import { MODIFIER_SECTIONS, type ModifierConfig, type ModifierStrength, type SettingsResponse } from "@job/shared";

// The sections the AI may rewrite: checkboxes when users choose them, else the sections of
// the selected strength (API configuration `modifier.userChoosesSections`).
export function ModifierSections(props: {
  settings: Pick<SettingsResponse, "modifierSectionChoice" | "modifierSectionsByStrength"> | null;
  strength: ModifierStrength;
  config: ModifierConfig;
  onChange: (config: ModifierConfig) => void;
}) {
  if (props.settings && !props.settings.modifierSectionChoice) {
    const sections = MODIFIER_SECTIONS.filter((section) => props.settings!.modifierSectionsByStrength[props.strength]?.[section]);
    return <span className="muted">modifies: {sections.join(", ") || "nothing"}</span>;
  }
  return (
    <span>
      {MODIFIER_SECTIONS.map((section) => (
        <label key={section}>
          <input type="checkbox" checked={props.config[section] ?? false} onChange={(event) => props.onChange({ ...props.config, [section]: event.target.checked })} />
          {section}
        </label>
      ))}
    </span>
  );
}
