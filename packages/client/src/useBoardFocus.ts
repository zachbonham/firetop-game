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
    // Phones fire `resize` whenever the address bar slides in or out while scrolling. Re-centring
    // then yanks the board away from the player's finger, so only a real width change (rotation)
    // counts.
    let width = window.innerWidth;
    const onResize = () => {
      if (window.innerWidth === width) return;
      width = window.innerWidth;
      centre();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node, ...deps]);
}
