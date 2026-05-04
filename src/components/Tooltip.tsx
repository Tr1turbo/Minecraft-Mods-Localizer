import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

type TooltipPlacement = "top" | "bottom";

export function Tooltip({
  content,
  children,
  className,
  disabled,
}: {
  content: ReactNode;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<TooltipPlacement>("top");
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const hasContent = Boolean(content && (typeof content !== "string" || content.trim()));
  const visible = open && hasContent && !disabled;

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    const tooltip = tooltipRef.current;
    if (!anchor || !tooltip) {
      return;
    }
    const gap = 10;
    const margin = 12;
    const anchorRect = anchor.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const nextPlacement = anchorRect.top - tooltipRect.height - gap < margin ? "bottom" : "top";
    const unclampedLeft = anchorRect.left + anchorRect.width / 2 - tooltipRect.width / 2;
    const left = Math.min(Math.max(unclampedLeft, margin), window.innerWidth - tooltipRect.width - margin);
    const top =
      nextPlacement === "top"
        ? Math.max(anchorRect.top - tooltipRect.height - gap, margin)
        : Math.min(anchorRect.bottom + gap, window.innerHeight - tooltipRect.height - margin);
    setPlacement(nextPlacement);
    setPosition({ left, top });
  }, []);

  useLayoutEffect(() => {
    if (!visible) {
      return;
    }
    updatePosition();
  }, [content, updatePosition, visible]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [updatePosition, visible]);

  return (
    <>
      <span
        ref={anchorRef}
        className={className ? `tooltipAnchor ${className}` : "tooltipAnchor"}
        aria-describedby={visible ? id : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        {children}
      </span>
      {visible
        ? createPortal(
            <div
              ref={tooltipRef}
              id={id}
              role="tooltip"
              className={`tooltipBubble ${placement}`}
              style={{ left: position.left, top: position.top }}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
