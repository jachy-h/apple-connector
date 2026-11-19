import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface PopoverAnchor {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

interface FloatingPopoverProps {
  anchor: PopoverAnchor | null;
  children: ReactNode;
  onClose(): void;
}

type Placement = 'top' | 'bottom';

interface Position {
  left: number;
  top: number;
  placement: Placement;
  arrowX: number;
  ready: boolean;
}

const MARGIN = 10;
const GAP = 9;

/**
 * One global, portal-rendered popover used by every heatmap cell. Keeping a single
 * instance avoids per-cell tooltips being clipped by the horizontally scrolling card.
 */
export function FloatingPopover({ anchor, children, onClose }: FloatingPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<Position>({ left: 0, top: 0, placement: 'top', arrowX: 0, ready: false });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!anchor || !element) return;
    const rect = element.getBoundingClientRect();
    const centerX = anchor.left + anchor.width / 2;
    const left = Math.min(Math.max(MARGIN, centerX - rect.width / 2), window.innerWidth - rect.width - MARGIN);
    let placement: Placement = 'top';
    let top = anchor.top - rect.height - GAP;
    if (top < MARGIN) {
      placement = 'bottom';
      top = anchor.bottom + GAP;
    }
    if (top + rect.height > window.innerHeight - MARGIN) top = Math.max(MARGIN, window.innerHeight - rect.height - MARGIN);
    const arrowX = Math.min(Math.max(16, centerX - left), rect.width - 16);
    setPosition({ left, top, placement, arrowX, ready: true });
  }, [anchor]);

  useEffect(() => {
    if (!anchor) return;
    const close = () => onClose();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [anchor, onClose]);

  if (!anchor) return null;
  return createPortal(<div
    ref={ref}
    className={`floating-popover placement-${position.placement}`}
    style={{ left: position.left, top: position.top, opacity: position.ready ? 1 : 0, '--arrow-x': `${position.arrowX}px` } as CSSProperties}
    role="tooltip"
    data-placement={position.placement}
  >
    {children}
    <i className="floating-popover-arrow" aria-hidden="true" />
  </div>, document.body);
}
