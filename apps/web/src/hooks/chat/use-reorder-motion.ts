import { useLayoutEffect, useRef } from "react";

// Animate only user-initiated reorders; loading saved cards stays still.
export function useReorderMotion(order: string[]) {
  const rows = useRef(new Map<string, HTMLLIElement>());
  const before = useRef(new Map<string, number>());
  const animations = useRef<Animation[]>([]);
  const draggedRow = useRef<string | undefined>(undefined);
  function capture(dragged?: string) {
    draggedRow.current = dragged;
    before.current = new Map(
      [...rows.current].map(([id, row]) => [
        id,
        row.getBoundingClientRect().top,
      ]),
    );
    for (const animation of animations.current) animation.cancel();
    animations.current = [];
  }
  useLayoutEffect(() => {
    if (!before.current.size) return;
    if (!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      for (const [id, row] of rows.current) {
        const previous = before.current.get(id);
        if (previous === undefined || id === draggedRow.current || !row.animate)
          continue;
        const distance = previous - row.getBoundingClientRect().top;
        if (Math.abs(distance) < 1) continue;
        animations.current.push(
          row.animate(
            [
              { transform: `translateY(${distance}px)` },
              { transform: "translateY(0)" },
            ],
            { duration: 220, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
          ),
        );
      }
    }
    before.current.clear();
  }, [order]);
  useLayoutEffect(
    () => () => {
      for (const animation of animations.current) animation.cancel();
    },
    [],
  );
  return { rows, capture };
}
