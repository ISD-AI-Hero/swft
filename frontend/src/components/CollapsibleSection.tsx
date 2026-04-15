// Reusable accordion-style wrapper for dashboard sections.
import { ReactNode, useId, useState } from "react";

type CollapsibleSectionProps = {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  children: ReactNode;
  actions?: ReactNode;
};

export const CollapsibleSection = ({ title, description, defaultOpen = true, children, actions }: CollapsibleSectionProps) => {
  const [open, setOpen] = useState<boolean>(defaultOpen);
  const contentId = useId();
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm transition dark:border-slate-800 dark:bg-slate-900/60">
      <header className="flex items-start justify-between gap-4 px-5 py-4">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={contentId}
          className="flex flex-1 items-start gap-3 text-left text-slate-900 dark:text-white"
        >
          <span className="mt-1 flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 bg-slate-100 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {open ? "−" : "+"}
          </span>
          <span>
            <h3 className="text-lg font-semibold">{title}</h3>
            {description && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>}
          </span>
        </button>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </header>
      <div id={contentId} hidden={!open} className="border-t border-slate-200 px-5 py-5 dark:border-slate-800">{children}</div>
    </section>
  );
};
