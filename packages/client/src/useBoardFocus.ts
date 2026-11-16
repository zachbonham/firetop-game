import { useEffect, useState, type RefObject } from "react";

/** True on phone-sized screens (the same breakpoint as the phone CSS). */
export function useIsPhone(): boolean {
  const query = "(max-width: 820px)";
  const [phone, setPhone] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setPhone(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return phone;
}

/**
 * When the board is bigger than its scrolling wrapper (wider on the zoomed
 * landscape board, taller on the portrait one), keep `node` (a data-node id,
 * e.g. the current player's square) centred. Does nothing when the board fits.
 */
export function useBoardFocus(wrapRef: RefObject<HTMLElement | null>, node: string | null | undefined, deps: unknown[]): void {
  useEffect(() => {
    const centre = () => {
      const wrap = wrapRef.current;
      if (!wrap || !node) return;
      const wide = wrap.scrollWidth > wrap.clientWidth, tall = wrap.scrollHeight > wrap.clientHeight;
      if (!wide && !tall) return;
      const el = wrap.querySelector(`[data-node="${CSS.escape(node)}"]`);
      if (!el) return;
      const w = wrap.getBoundingClientRect(), r = el.getBoundingClientRect();
      wrap.scrollTo({
        ...(wide ? { left: wrap.scrollLeft + r.left + r.width / 2 - (w.left + w.width / 2) } : {}),
        ...(tall ? { top: wrap.scrollTop + r.top + r.height / 2 - (w.top + w.height / 2) } : {}),
        behavior: "smooth",
      });
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
