import { useEffect, type RefObject } from "react";

/**
 * On small screens the board is wider than the screen (it scrolls sideways):
 * keep `node` (a data-node id, e.g. the current player's square) centred.
 * Does nothing when the board fits.
 */
export function useBoardFocus(wrapRef: RefObject<HTMLElement | null>, node: string | null | undefined, deps: unknown[]): void {
  useEffect(() => {
    const centre = () => {
      const wrap = wrapRef.current;
      if (!wrap || wrap.scrollWidth <= wrap.clientWidth || !node) return;
      const el = wrap.querySelector(`[data-node="${CSS.escape(node)}"]`);
      if (!el) return;
      const w = wrap.getBoundingClientRect(), r = el.getBoundingClientRect();
      wrap.scrollTo({ left: wrap.scrollLeft + r.left + r.width / 2 - (w.left + w.width / 2), behavior: "smooth" });
    };
    centre();
    window.addEventListener("resize", centre);
    return () => window.removeEventListener("resize", centre);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node, ...deps]);
}
