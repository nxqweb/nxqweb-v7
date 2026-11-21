import { useEffect, useState, type ReactNode } from "react";

// A collapsible "optional" block. It opens by itself when the client already has answers inside (so nothing filled in is hidden), but once
// the client has it open it never closes under their cursor, for example while they clear a box. Native <details>, so it works without scripts.
export function OptionalSection({ className, defaultOpen, title, hint, icon, children }: { className?: string; defaultOpen: boolean; title: string; hint: string; icon?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => { if (defaultOpen) setOpen(true); }, [defaultOpen]);
  return (
    <details className={`${className ? `${className} ` : ""}optional-section`} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="optional-summary">{icon}<span><strong>{title}</strong> <em className="optional-tag">optional</em><small>{hint}</small></span></summary>
      {children}
    </details>
  );
}
