import { useState } from "react";

// Textarea editing a JSON value. `onSave` receives the parsed value.
export function JsonEditor({ value, onSave, label = "Save" }: { value: unknown; onSave: (value: unknown) => void; label?: string }) {
  const [text, setText] = useState(JSON.stringify(value, null, 2));
  const [error, setError] = useState("");

  function save() {
    try {
      onSave(JSON.parse(text));
      setError("");
    } catch (parseError) {
      setError(String(parseError));
    }
  }

  return (
    <div>
      <textarea rows={24} style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }} value={text} onChange={(event) => setText(event.target.value)} />
      <button onClick={save}>{label}</button> {error && <span className="error">{error}</span>}
    </div>
  );
}
