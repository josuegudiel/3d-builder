/**
 * Iconos SVG de la barra de herramientas. Trazo de 1.6 px sobre una rejilla de
 * 24 px, para que todos tengan el mismo peso visual.
 */

const wrap = (body: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS: Record<string, string> = {
  select: wrap('<path d="M5 3l6.5 16 2.2-6.4L20 10.4z"/>'),
  line: wrap('<path d="M4 20L20 4"/><circle cx="4" cy="20" r="1.6" fill="currentColor"/><circle cx="20" cy="4" r="1.6" fill="currentColor"/>'),
  rectangle: wrap('<rect x="3.5" y="6" width="17" height="12" rx="0.6"/>'),
  circle: wrap('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>'),
  polygon: wrap('<path d="M12 3.6l7.4 4.3v8.2L12 20.4 4.6 16.1V7.9z"/>'),
  arc: wrap('<path d="M4 18a8 8 0 0116 0"/><circle cx="4" cy="18" r="1.5" fill="currentColor"/><circle cx="20" cy="18" r="1.5" fill="currentColor"/>'),
  arc3: wrap('<path d="M3.5 17.5C6 9 18 9 20.5 17.5"/><circle cx="12" cy="11" r="1.4" fill="currentColor"/>'),
  pushpull: wrap('<path d="M4 14.5l6-3.2 6 3.2-6 3.2z"/><path d="M10 11.3V4.4"/><path d="M7.6 6.6L10 4.2l2.4 2.4"/><path d="M16 14.5v3.6l-6 3.2-6-3.2v-3.6"/>'),
  move: wrap('<path d="M12 3v18M3 12h18"/><path d="M12 3l-2.4 2.6M12 3l2.4 2.6M12 21l-2.4-2.6M12 21l2.4-2.6M3 12l2.6-2.4M3 12l2.6 2.4M21 12l-2.6-2.4M21 12l2.6 2.4"/>'),
  rotate: wrap('<path d="M20 12a8 8 0 11-3.2-6.4"/><path d="M20.6 3.6v4.6h-4.6"/>'),
  scale: wrap('<rect x="4" y="4" width="10" height="10"/><path d="M14 14l6 6"/><path d="M20 14.6V20h-5.4"/>'),
  offset: wrap('<rect x="3.5" y="6" width="17" height="12" rx="0.6"/><rect x="6.5" y="9" width="11" height="6" rx="0.4" stroke-dasharray="2.4 2"/>'),
  followme: wrap('<path d="M3 18c4-11 14-11 18 0"/><rect x="1.6" y="15.6" width="4.8" height="4.8" rx="0.5"/>'),
  eraser: wrap('<path d="M7.5 20.5L3 16l9.5-9.5a2 2 0 012.8 0l3.7 3.7a2 2 0 010 2.8L11.5 20.5z"/><path d="M20.5 20.5h-9"/>'),
  paint: wrap('<path d="M4.5 10.5V5.6A1.6 1.6 0 016.1 4h9.3a1.6 1.6 0 011.6 1.6v4.9z"/><path d="M17 7.4h2.2a1.4 1.4 0 011.4 1.4v3.4a1.4 1.4 0 01-1.4 1.4H12"/><rect x="8.6" y="13.6" width="4.4" height="6.8" rx="1.1"/>'),
  tape: wrap('<circle cx="8" cy="14" r="4.4"/><circle cx="8" cy="14" r="1.2" fill="currentColor"/><path d="M12.2 12.2L21 6.4"/><path d="M17.6 5.2l3.6 1.2-1 3.6"/>'),
  protractor: wrap('<path d="M3.5 18a8.5 8.5 0 0117 0z"/><path d="M12 18V9.5M12 18l7.4-4.3"/>'),
  dimension: wrap('<path d="M3 8v8M21 8v8M3 12h18"/><path d="M5.4 10.2L3 12l2.4 1.8M18.6 10.2L21 12l-2.4 1.8"/>'),
  orbit: wrap('<circle cx="12" cy="12" r="8"/><ellipse cx="12" cy="12" rx="8" ry="3.4"/><ellipse cx="12" cy="12" rx="3.4" ry="8"/>'),
  pan: wrap('<path d="M9 11V5.4a1.6 1.6 0 013.2 0V11"/><path d="M12.2 11V6.6a1.6 1.6 0 013.2 0V11"/><path d="M15.4 11.4V8.6a1.6 1.6 0 013.2 0V15a6 6 0 01-6 6h-1.2a5 5 0 01-3.6-1.5L4 15.4a1.6 1.6 0 012.3-2.2L9 15.4V11"/>'),
  zoom: wrap('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.4 15.4L21 21M8 10.5h5M10.5 8v5"/>'),
  group: wrap('<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/><path d="M11 7h6a2 2 0 012 2v4" stroke-dasharray="2.4 2"/>'),
  undo: wrap('<path d="M4 9h10a5 5 0 010 10h-4"/><path d="M7.6 5.4L4 9l3.6 3.6"/>'),
  redo: wrap('<path d="M20 9H10a5 5 0 000 10h4"/><path d="M16.4 5.4L20 9l-3.6 3.6"/>'),
  extents: wrap('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><rect x="8.6" y="8.6" width="6.8" height="6.8" rx="0.6"/>'),
  logo: wrap('<path d="M12 2.6l8.4 4.7v9.4L12 21.4 3.6 16.7V7.3z"/><path d="M3.6 7.3L12 12l8.4-4.7M12 12v9.4"/>'),
};

export function icon(name: string): string {
  return ICONS[name] ?? ICONS.select;
}
