/* Tracés 24x24 en trait, dessinés pour cette interface. */
const PATHS = {
  home: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  control: '<circle cx="12" cy="12" r="3"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>',
  files: '<path d="M3 6h7l2 2h9v11H3z"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
  camera: '<path d="M3 7h4l2-3h6l2 3h4v13H3z"/><circle cx="12" cy="13" r="4"/>',
  log: '<path d="M4 5h16M4 10h16M4 15h10M4 20h7"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  stop: '<rect x="6" y="6" width="12" height="12"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/>',
  octagon: '<path d="M8 2h8l6 6v8l-6 6H8l-6-6V8z"/><path d="M12 7v6M12 16.5v.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V17h5v-1.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>',
  fan: '<circle cx="12" cy="12" r="1.8"/><path d="M12 10.2C11 6 12.5 3 15 3c2 0 2.5 2.4.5 4.2L13.6 9"/><path d="M13.6 12.7c4.2.6 6.7 2.8 5.9 5.1-.6 1.9-3 1.6-4.1-.8L14.3 14"/><path d="M10.6 13.2c-2.9 3.1-6 3.6-7.3 1.5-1-1.7.9-3.3 3.5-2.6l2.6.6"/>',
  thermo: '<path d="M10 4a2 2 0 1 1 4 0v10.5a4 4 0 1 1-4 0z"/><path d="M12 10v6"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v4h16v-4"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  shrink: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
  snapshot: '<path d="M4 8V5h3M20 8V5h-3M4 16v3h3M20 16v3h-3"/><circle cx="12" cy="12" r="3"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff:
    '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.9M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.7 0 3.2-.5 4.5-1.2"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  crosshair: '<circle cx="12" cy="12" r="8"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  left: '<path d="m15 6-6 6 6 6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  chevronsUp: '<path d="m6 13 6-6 6 6M6 19l6-6 6 6"/>',
  chevronsDown: '<path d="m6 5 6 6 6-6M6 11l6 6 6-6"/>',
  spool:
    '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v6M12 15v6"/>',
  bot: '<rect x="4" y="8" width="16" height="12"/><path d="M12 4v4M9 13v2M15 13v2"/>',
  send: '<path d="M21 3 3 10.5l7 3 3 7z"/><path d="m10 13.5 4-4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  film: '<rect x="3" y="4" width="18" height="16"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  report: '<path d="M6 3h9l4 4v14H6z"/><path d="M9 13h6M9 17h6M9 9h3"/>',
  wrench:
    '<path d="M14.7 6.3a4 4 0 0 0 5 5L22 14l-8 8-2.4-2.4a4 4 0 0 0-5-5L3 11l3-3 3.6 3.6a4 4 0 0 0 5-5z"/>',
  gauge: '<path d="M4 18a9 9 0 1 1 16 0"/><path d="m12 14 4-5"/>',
  drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  hdd: '<rect x="3" y="13" width="18" height="7"/><path d="M5 13 7 4h10l2 9M7 16.5h.5"/>',
  usb: '<path d="M12 3v14M9 6l3-3 3 3"/><circle cx="12" cy="19" r="2"/><path d="M12 13l-4-2V8M12 11l4-2V7"/><rect x="6.5" y="6.5" width="3" height="2"/>',
  folder: '<path d="M3 6h7l2 2h9v11H3z"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  queue: '<path d="M4 6h16M4 12h16M4 18h10"/><path d="m17 16 3 2-3 2z"/>',
  bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
  sliders:
    '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  sparkle: '<path d="M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2z"/>',
  grid: '<path d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${PATHS[name]}</svg>`;
}
