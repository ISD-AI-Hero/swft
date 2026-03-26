// Small tooltip-style popover used for inline help copy.
import { useEffect, useRef, useState, type ReactNode } from "react";

type InfoPopoverProps = {
  title: string;
  description?: string;
  items?: ReadonlyArray<{ label?: string; content: ReactNode }>;
  align?: "left" | "right";
};

export const InfoPopover = ({ title, description, items, align = "right" }: InfoPopoverProps) => {
  const [open, setOpen] = useState(false);
  const [calculatedAlign, setCalculatedAlign] = useState<"left" | "right">(align);
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Reset calculated alignment when align prop changes or popover closes
  useEffect(() => {
    if (!open) {
      setCalculatedAlign(align);
    }
  }, [open, align]);

  // Calculate optimal alignment based on available viewport space
  useEffect(() => {
    if (!open || !containerRef.current) return;

    const calculateAlignment = () => {
      const button = containerRef.current;
      const popover = popoverRef.current;
      if (!button) return;

      // Wait for popover to render and measure its actual width
      const buttonRect = button.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      
      // Use actual popover width if available, otherwise fallback to expected width
      const popoverWidth = popover ? popover.getBoundingClientRect().width : 288; // w-72 = 18rem = 288px
      const minSpace = popoverWidth + 16; // Add 16px padding for safety

      const spaceOnRight = viewportWidth - buttonRect.right;
      const spaceOnLeft = buttonRect.left;

      // Alignment is relative to the button, not the viewport:
      // - "left" alignment: popup's left corner aligns under the button (popup extends right)
      // - "right" alignment: popup's right corner aligns under the button (popup extends left)
      // Reversed logic: Check opposite side's space to determine if preferred alignment will fit
      // If align="right": Check if there's space on left (popup extends left) -> use right if space available
      // If align="left": Check if there's space on right (popup extends right) -> use left if space available
      let bestAlign: "left" | "right";
      if (align === "right") {
        // Check space on left first - if there's space on left, we're near right edge, so align right
        if (spaceOnLeft >= minSpace) {
          bestAlign = "right";
        } else if (spaceOnRight >= minSpace) {
          bestAlign = "left";
        } else {
          // Neither side has enough, use the side with more space (reversed logic)
          bestAlign = spaceOnLeft > spaceOnRight ? "right" : "left";
        }
      } else {
        // Check space on right first - if there's space on right, we're near left edge, so align left
        if (spaceOnRight >= minSpace) {
          bestAlign = "left";
        } else if (spaceOnLeft >= minSpace) {
          bestAlign = "right";
        } else {
          // Neither side has enough, use the side with more space (reversed logic)
          bestAlign = spaceOnRight > spaceOnLeft ? "left" : "right";
        }
      }
      setCalculatedAlign(bestAlign);
    };

    // Use requestAnimationFrame to ensure DOM is ready after popover renders
    const rafId = requestAnimationFrame(() => {
      // Double RAF to ensure layout is complete
      requestAnimationFrame(calculateAlignment);
    });

    // Recalculate on window resize when popover is open
    window.addEventListener("resize", calculateAlignment);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", calculateAlignment);
    };
  }, [open, align]);

  // Handle click outside to close
  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const alignmentClass = calculatedAlign === "left" ? "left-0" : "right-0";

  return (
    <div className="relative inline-block" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={`More information about ${title}`}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 bg-white text-xs font-semibold text-slate-600 shadow-sm transition hover:border-slate-400 hover:text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:text-slate-50"
      >
        ?
      </button>
      {open && (
        <div ref={popoverRef} className={`absolute z-20 mt-2 w-72 rounded-lg border border-slate-200 bg-white text-left shadow-lg dark:border-slate-700 dark:bg-slate-900 ${alignmentClass}`}>
          <div className="space-y-3 p-4 text-sm text-slate-600 dark:text-slate-300">
            <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h4>
            {description ? <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">{description}</p> : null}
            {items && items.length > 0 ? (
              <ul className="space-y-2 text-xs leading-relaxed">
                {items.map((item, index) => (
                  <li key={item.label ?? index}>
                    {item.label ? <span className="font-semibold text-slate-700 dark:text-slate-200">{item.label}: </span> : null}
                    <span>{item.content}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};
