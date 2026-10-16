import { Loader2, MapPin, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LocationSummary } from "@job/shared";
import { useLocationSuggestions } from "../api/queries";
import { placeContext } from "../lib/format";
import { useDebounced } from "../lib/use-debounced";

// Search location with suggestions (FEATURE O1; as in the test client). A place must be
// picked from the suggestions: the search uses its id.
export function LocationInput({ value, onChange }: { value: { id: number; name: string } | null; onChange: (place: LocationSummary | null) => void }) {
  const { t } = useTranslation();
  const listId = useId();
  const [text, setText] = useState(value?.name ?? "");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const typed = useDebounced(text, 180);
  const suggestions = useLocationSuggestions(open ? typed : "");
  const results = open && text.trim().length >= 2 ? (suggestions.data?.results ?? []) : [];

  // The address changed (back button, link): show its place.
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setText(value?.name ?? "");
  }, [value?.id, value?.name]);

  useEffect(() => setHighlight(0), [typed]);

  const pick = (place: LocationSummary) => {
    setText(place.name);
    setOpen(false);
    onChange(place);
  };

  return (
    <div className="relative">
      <label className="flex h-9 items-center gap-2 rounded-control border border-border bg-surface px-2.5 transition-colors duration-150 focus-within:border-accent">
        <MapPin size={16} className="shrink-0 text-fg-subtle" />
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={t("search.location")}
          aria-activedescendant={results.length ? `${listId}-${highlight}` : undefined}
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-fg-subtle"
          placeholder={t("search.location")}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setOpen(true);
          }}
          onFocus={(event) => event.target.select()}
          onBlur={() => {
            setOpen(false);
            setText(value?.name ?? "");
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && results.length) {
              event.preventDefault();
              setHighlight((index) => (index + 1) % results.length);
            } else if (event.key === "ArrowUp" && results.length) {
              event.preventDefault();
              setHighlight((index) => (index - 1 + results.length) % results.length);
            } else if (event.key === "Enter" && results[highlight]) {
              event.preventDefault();
              pick(results[highlight]);
            } else if (event.key === "Escape") {
              setOpen(false);
              setText(value?.name ?? "");
            }
          }}
        />
        {suggestions.isFetching && open && <Loader2 size={14} className="shrink-0 animate-spin text-fg-subtle" />}
        {value && !open && (
          <button
            type="button"
            aria-label={t("search.clearLocation")}
            onClick={() => {
              setText("");
              onChange(null);
            }}
            className="flex size-5 shrink-0 items-center justify-center rounded-control text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
          >
            <X size={14} />
          </button>
        )}
      </label>
      {open && text.trim().length >= 2 && (results.length > 0 || !suggestions.isFetching) && (
        <ul
          id={listId}
          role="listbox"
          className="animate-pop-in absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-box border border-border bg-surface p-1 shadow-float"
        >
          {results.length === 0 && <li className="px-2 py-1.5 text-sm text-fg-subtle">{t("search.noPlace")}</li>}
          {results.map((place, index) => (
            <li
              key={place.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === highlight}
              // Before the input's blur, so the click counts. A click (or tap) is the end of
              // the input: the field lets go of the focus, and on phones the keyboard closes.
              // Blurred first, so the field's blur handler doesn't undo the choice.
              onPointerDown={(event) => {
                event.preventDefault();
                inputRef.current?.blur();
                pick(place);
              }}
              onPointerEnter={() => setHighlight(index)}
              className={`flex cursor-default items-baseline gap-2 rounded-control px-2 py-1.5 text-sm ${index === highlight ? "bg-hover" : ""}`}
            >
              <span className="truncate">{place.name}</span>
              <span className="truncate text-xs text-fg-subtle">{placeContext(place)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
