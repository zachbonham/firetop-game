/**
 * Generated SVG icons (original artwork, no third-party assets). Every icon is
 * drawn in a 24x24 box centred on (0, 0), so it can be placed inside the board
 * SVG with <Icon x y size /> or used inline in HTML via <IconSvg />.
 */
import type { Archetype, ItemId } from "@firetop/engine";

export type IconName =
  | ItemId
  | "key" | "monster" | "treasure" | "trap" | "camp" | "entrance" | "lair" | "maze" | "skull"
  | "dice" | "crossedSwords" | "crown" | "eye" | "heart" | "clover" | "unknown";

const INK = "#1b1712";

/** Paths for each icon, drawn in [-12, 12]. `fill` uses currentColor unless noted. */
function shapes(name: IconName) {
  switch (name) {
    case "key":
      return (
        <g fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
          <circle cx={-5} cy={0} r={4.5} />
          <path d="M-0.5 0H10M6 0v4M9.5 0v3" />
        </g>
      );
    case "provisions":
      return (
        <g>
          <ellipse cx={0} cy={2} rx={9} ry={6} fill="#c98b4a" stroke={INK} strokeWidth={1.2} />
          <path d="M-7 0q7 -6 14 0" fill="none" stroke="#f3d7a8" strokeWidth={1.6} />
          <rect x={-1.5} y={-9} width={3} height={7} rx={1} fill="#efe6d4" stroke={INK} strokeWidth={1} />
        </g>
      );
    case "skillPotion":
    case "luckPotion": {
      const liquid = name === "skillPotion" ? "#e0503a" : "#3cb878";
      return (
        <g stroke={INK} strokeWidth={1.2}>
          <path d="M-3 -10h6v5l6 9a4 4 0 0 1 -3.5 6h-11a4 4 0 0 1 -3.5 -6l6 -9z" fill="#d9e6ef" />
          <path d="M-6.6 1h13.2l2.6 4a3 3 0 0 1 -2.6 4.5h-13.2a3 3 0 0 1 -2.6 -4.5z" fill={liquid} />
          <rect x={-4} y={-12} width={8} height={3} rx={1} fill="#8a6a45" />
        </g>
      );
    }
    case "sword":
      return (
        <g stroke={INK} strokeWidth={1.1}>
          <path d="M-1.6 -11.5h3.2v15h-3.2z" fill="#dfe7ee" />
          <path d="M-7 3.5h14v2.6h-14z" fill="#c9a24a" />
          <path d="M-1.5 6.1h3v4.4h-3z" fill="#6b4a2b" />
          <circle cx={0} cy={11.4} r={1.6} fill="#c9a24a" />
        </g>
      );
    case "shield":
      return (
        <g stroke={INK} strokeWidth={1.2}>
          <path d="M0 -11l9 3.5v6c0 6 -4 10 -9 12.5c-5 -2.5 -9 -6.5 -9 -12.5v-6z" fill="#7d8fa3" />
          <path d="M0 -7.5v18M-6.5 -2h13" stroke="#e8edf2" strokeWidth={2} />
        </g>
      );
    case "amulet":
      return (
        <g stroke={INK} strokeWidth={1.1}>
          <path d="M-7 -11q7 9 14 0" fill="none" stroke="#c9a24a" strokeWidth={1.6} />
          <path d="M0 -4l6 7l-6 8l-6 -8z" fill="#8f5bd6" />
          <path d="M0 -1l2.6 4l-2.6 3.5l-2.6 -3.5z" fill="#d9c4ff" stroke="none" />
        </g>
      );
    case "scroll":
      return (
        <g stroke={INK} strokeWidth={1.1}>
          <rect x={-8} y={-8} width={16} height={16} rx={1.5} fill="#ead8b0" />
          <rect x={-10} y={-10} width={20} height={4} rx={2} fill="#c9a87a" />
          <rect x={-10} y={6} width={20} height={4} rx={2} fill="#c9a87a" />
          <path d="M-5 -2.5h10M-5 1h7M-5 4h9" stroke="#7b5d3a" strokeWidth={1} />
        </g>
      );
    case "monster":
      return (
        <g stroke={INK} strokeWidth={1.1}>
          <path d="M-10 -2c0 -7 4.5 -10 10 -10s10 3 10 10c0 4 -2 7 -4 9l-2 4l-2 -3l-2 3l-2 -3l-2 3l-2 -3l-2 3l-2 -4c-2 -2 -4 -5 -4 -9z" fill="#6d8f4e" />
          <path d="M-10 -5l-2 -6l5 3M10 -5l2 -6l-5 3" fill="#6d8f4e" />
          <path d="M-6 -3l4 1.5l-4 1.5z M6 -3l-4 1.5l4 1.5z" fill="#f2d24b" />
        </g>
      );
    case "treasure":
      return (
        <g stroke={INK} strokeWidth={1.2}>
          <path d="M-10 -1h20v10h-20z" fill="#8a5a2b" />
          <path d="M-10 -1v-3a10 6 0 0 1 20 0v3z" fill="#a46c34" />
          <path d="M-10 3h20" stroke="#c9a24a" strokeWidth={1.6} />
          <rect x={-2} y={0.5} width={4} height={5} rx={1} fill="#e8c55a" />
        </g>
      );
    case "trap":
      return (
        <g stroke={INK} strokeWidth={1.1}>
          <path d="M-11 8h22v3h-22z" fill="#5b5550" />
          <path d="M-10 8l2.5 -14l2.5 14zM-4 8l2.5 -18l2.5 18zM3 8l2.5 -15l2.5 15z" fill="#b9bec4" />
        </g>
      );
    case "camp":
      return (
        <g stroke={INK} strokeWidth={1.1}>
          <path d="M-11 9l11 -19l11 19z" fill="#b7793d" />
          <path d="M0 -10l-4 19h8z" fill="#3b2a1b" />
          <path d="M-8 11h16" stroke="#e8823a" strokeWidth={2} />
          <path d="M-3 11q3 -6 6 0" fill="#f2b33d" stroke="#e8823a" />
        </g>
      );
    case "entrance":
      return (
        <g stroke={INK} strokeWidth={1.2}>
          <path d="M-10 11v-12a10 10 0 0 1 20 0v12z" fill="#6b6259" />
          <path d="M-6 11v-11a6 6 0 0 1 12 0v11z" fill="#17130f" />
          <path d="M-3 11v-9M0 11v-10.5M3 11v-9" stroke="#8a7f74" strokeWidth={1} />
        </g>
      );
    case "lair":
      return (
        <g stroke={INK} strokeWidth={1.1}>
          <path d="M-8 11v-15l-2 -2v-4h4v2h3v-2h6v2h3v-2h4v4l-2 2v15z" fill="#4b3f66" />
          <path d="M-2.5 11v-6a2.5 2.5 0 0 1 5 0v6z" fill="#f2b33d" />
          <path d="M-1 -4h2v3h-2z" fill="#f2b33d" />
        </g>
      );
    case "maze":
      return (
        <g fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="square">
          <rect x={-10} y={-10} width={20} height={20} />
          <path d="M-10 -3h14M4 -3v8M-4 3v7M-4 3h-3M10 4h-3" />
        </g>
      );
    case "skull":
      return (
        <g stroke={INK} strokeWidth={1.1}>
          <path d="M-9 -1a9 9 0 0 1 18 0c0 3 -1.5 5 -3.5 6v4h-11v-4c-2 -1 -3.5 -3 -3.5 -6z" fill="#e8e1d2" />
          <circle cx={-3.5} cy={0} r={2.4} fill={INK} />
          <circle cx={3.5} cy={0} r={2.4} fill={INK} />
          <path d="M-2 9v-3M2 9v-3" />
        </g>
      );
    case "dice":
      return (
        <g stroke={INK} strokeWidth={1.2}>
          <rect x={-9} y={-9} width={18} height={18} rx={4} fill="#efe6d4" />
          {[[-4.5, -4.5], [4.5, 4.5], [0, 0], [4.5, -4.5], [-4.5, 4.5]].map(([x, y]) => (
            <circle key={`${x},${y}`} cx={x} cy={y} r={1.7} fill={INK} stroke="none" />
          ))}
        </g>
      );
    case "crossedSwords":
      return (
        <g stroke={INK} strokeWidth={1}>
          <g transform="rotate(40)"><path d="M-1.3 -11h2.6v13h-2.6z" fill="#dfe7ee" /><path d="M-5 2h10v2h-10z" fill="#c9a24a" /><path d="M-1.2 4h2.4v5h-2.4z" fill="#6b4a2b" /></g>
          <g transform="rotate(-40)"><path d="M-1.3 -11h2.6v13h-2.6z" fill="#dfe7ee" /><path d="M-5 2h10v2h-10z" fill="#c9a24a" /><path d="M-1.2 4h2.4v5h-2.4z" fill="#6b4a2b" /></g>
        </g>
      );
    case "crown":
      return <path d="M-10 7l-1 -13l6 6l5 -9l5 9l6 -6l-1 13z" fill="#e8c55a" stroke={INK} strokeWidth={1.2} />;
    case "eye":
      return (
        <g stroke={INK} strokeWidth={1.1}>
          <path d="M-11 0q11 -11 22 0q-11 11 -22 0z" fill="#efe6d4" />
          <circle cx={0} cy={0} r={4} fill="#8f5bd6" />
          <circle cx={0} cy={0} r={1.6} fill={INK} />
        </g>
      );
    case "heart":
      return <path d="M0 10c-7 -5 -11 -9 -11 -14a5.5 5.5 0 0 1 11 -1.5a5.5 5.5 0 0 1 11 1.5c0 5 -4 9 -11 14z" fill="#e0503a" stroke={INK} strokeWidth={1.1} />;
    case "clover":
      return (
        <g fill="#3cb878" stroke={INK} strokeWidth={1}>
          <circle cx={0} cy={-5} r={4.6} /><circle cx={-5} cy={0} r={4.6} /><circle cx={5} cy={0} r={4.6} /><circle cx={0} cy={5} r={4.6} />
          <path d="M0 5l3 7" fill="none" stroke="#2b7d50" strokeWidth={1.8} />
        </g>
      );
    case "unknown":
      return (
        <g>
          <circle cx={0} cy={0} r={10} fill="#3a3550" stroke="#8b7fc0" strokeWidth={1.2} />
          <text x={0} y={5} textAnchor="middle" fontSize={14} fontWeight={700} fill="#cfc6f0">?</text>
        </g>
      );
  }
}

/** An icon placed inside an existing SVG, centred on (x, y). */
export function Icon({ name, x = 0, y = 0, size = 24, color }: { name: IconName; x?: number; y?: number; size?: number; color?: string }) {
  const k = size / 24;
  return (
    <g transform={`translate(${x} ${y}) scale(${k})`} style={color ? { color } : undefined} pointerEvents="none">
      {shapes(name)}
    </g>
  );
}

/** A standalone inline icon for HTML. */
export function IconSvg({ name, size = 20, color, title }: { name: IconName; size?: number; color?: string; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="-12 -12 24 24" className="icon" style={color ? { color } : undefined} role="img" aria-label={title ?? name}>
      {title && <title>{title}</title>}
      {shapes(name)}
    </svg>
  );
}

export const ARCHETYPE_ICON: Record<Archetype, IconName> = {
  warrior: "sword",
  survivor: "heart",
  lucky: "clover",
};
