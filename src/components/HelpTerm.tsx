import { useId, useState } from "react";
import { CircleHelp } from "lucide-react";
import { helpTerms, type HelpTermKey } from "../lib/helpTerms";

// A small "?" next to a word. Press it to read what the word means in plain language, press it again (or Escape) to hide it. Works with the keyboard.
export function HelpTerm({ term }: { term: HelpTermKey }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const entry = helpTerms[term];
  return (
    <span className="help-term">
      <button type="button" className="help-term-btn" aria-expanded={open} aria-controls={id} aria-label={`What is ${entry.name}?`} onClick={() => setOpen((value) => !value)} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}>
        <CircleHelp size={14} aria-hidden="true" />
      </button>
      {open ? <span className="help-term-text" id={id} role="note"><strong>{entry.name}:</strong> {entry.meaning}</span> : null}
    </span>
  );
}
