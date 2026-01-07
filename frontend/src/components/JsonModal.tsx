// Full-screen modal for viewing/downloading raw JSON/text content.
import { useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type JsonModalProps = {
  title: string;
  content: string;
  fileName?: string;
  onClose: () => void;
  mimeType?: string;
  downloadExtension?: string;
  hideDownload?: boolean;
};

export const JsonModal = ({ title, content, fileName, onClose, mimeType = "application/json", downloadExtension = "json", hideDownload = false }: JsonModalProps) => {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const normalizedExtension = downloadExtension.replace(/^\./, "") || "txt";

  const handleDownload = () => {
    const targetName = (fileName ?? "").trim();
    const sanitizedTitle = title
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-_.]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    const extension = normalizedExtension;
    const fallbackName = sanitizedTitle.length > 0 ? `${sanitizedTitle}.${extension}` : `document.${extension}`;
    const downloadName = targetName.length > 0 ? targetName : fallbackName;
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = downloadName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };
  const downloadLabel = normalizedExtension === "json" ? "Download JSON" : "Download file";
  const isMarkdown = mimeType === "text/markdown";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur dark:bg-slate-950/80">
      <div className="relative flex h-[80vh] w-[90vw] max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl transition dark:border-slate-700 dark:bg-slate-900">
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h2>
          <div className="flex items-center gap-2">
            {!hideDownload && (
              <button
                type="button"
                onClick={handleDownload}
                className="rounded-md border border-slate-300 px-3 py-1 text-sm font-medium text-blue-600 transition hover:border-blue-400 hover:text-blue-700 dark:border-slate-600 dark:text-blue-200 dark:hover:border-blue-400 dark:hover:text-blue-100"
              >
                {downloadLabel}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:text-white"
            >
              Close
            </button>
          </div>
        </header>
        {isMarkdown ? (
          <div className="flex-1 overflow-auto bg-white px-5 py-4 dark:bg-slate-900">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              className="prose prose-slate max-w-none dark:prose-invert prose-headings:scroll-mt-16"
            >
              {content}
            </ReactMarkdown>
          </div>
        ) : (
          <pre className="flex-1 overflow-auto bg-slate-100 px-5 py-4 text-xs leading-relaxed text-slate-800 dark:bg-slate-950 dark:text-slate-200">
            {content}
          </pre>
        )}
      </div>
    </div>
  );
};
