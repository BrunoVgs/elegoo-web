import { clock, duration, eta, prettyFile, temp } from '../format';
import { SPEED_MODES } from '../labels';
import { store } from '../store';
import { downloadBlob, h, ico, iconButton, setText } from './dom';
import { toast } from './toast';

const HUD_KEY = 'cc2-camera-hud';
const STREAM_URL = '/api/stream';
const RETRY_MS = 5000;
const FREEZE_CHECK_MS = 6000;

export interface CameraView {
  el: HTMLElement;
  destroy(): void;
}

function readHud(): boolean {
  try {
    return localStorage.getItem(HUD_KEY) !== '0';
  } catch {
    return true;
  }
}

/** Empreinte grossière d'une image (16x9 niveaux de gris) pour repérer un flux figé. */
function fingerprint(img: HTMLImageElement, ctx: CanvasRenderingContext2D): string | null {
  try {
    ctx.drawImage(img, 0, 0, 16, 9);
    const d = ctx.getImageData(0, 0, 16, 9).data;
    let out = '';
    for (let i = 0; i < d.length; i += 4) out += ((d[i] + d[i + 1] + d[i + 2]) >> 4).toString(36);
    return out;
  } catch {
    return null;
  }
}

export function cameraView(opts: { compact?: boolean } = {}): CameraView {
  let hud = readHud();
  let retry: ReturnType<typeof setTimeout> | null = null;
  let lastPrint = '';
  let sameCount = 0;
  let wasOffline = false;

  const img = h('img', { class: 'cam-img', alt: '' });
  const state = h('div', { class: 'cam-state' });
  const live = h('span', { class: 'cam-live' }, 'LIVE');
  const phase = h('span', { class: 'cam-phase' });
  const time = h('span', { class: 'cam-time num' });

  const title = h('div', { class: 'cam-title' });
  const progressFill = h('span');
  const progress = h('div', { class: 'cam-progress' }, progressFill);
  const pct = h('span', { class: 'cam-pct num' });
  const metrics = h('div', { class: 'cam-metrics num' });

  const hudToggle = iconButton(hud ? 'eye' : 'eyeOff', 'Afficher / masquer les infos', () => {
    hud = !hud;
    try {
      localStorage.setItem(HUD_KEY, hud ? '1' : '0');
    } catch {
      /* stockage indisponible : l'état reste en mémoire */
    }
    root.classList.toggle('no-hud', !hud);
    hudToggle.replaceChildren(ico(hud ? 'eye' : 'eyeOff'));
  });

  const snapBtn = iconButton('snapshot', 'Instantané', async () => {
    try {
      const res = await fetch('/api/snapshot');
      if (!res.ok) throw new Error(String(res.status));
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      downloadBlob(await res.blob(), `cc2-${stamp}.jpg`);
    } catch {
      toast('Instantané impossible : caméra indisponible', 'error');
    }
  });

  const fsBtn = iconButton('expand', 'Plein écran', () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void root.requestFullscreen?.();
  });

  const root = h(
    'div',
    { class: `cam ${opts.compact ? 'compact' : ''} ${hud ? '' : 'no-hud'}`.trim() },
    img,
    state,
    h(
      'div',
      { class: 'cam-top' },
      live,
      phase,
      h('span', { class: 'spacer' }),
      time,
      h('div', { class: 'cam-tools' }, hudToggle, snapBtn, fsBtn),
    ),
    h(
      'div',
      { class: 'cam-bottom' },
      h('div', { class: 'cam-headline' }, title, pct),
      progress,
      metrics,
    ),
  );

  const probe = document.createElement('canvas');
  probe.width = 16;
  probe.height = 9;
  const probeCtx = probe.getContext('2d', { willReadFrequently: true })!;

  const setState = (text: string, tone: '' | 'warn' | 'error') => {
    setText(state, text);
    state.className = `cam-state ${tone}`.trim();
    root.classList.toggle('degraded', tone !== '');
    root.classList.toggle('no-signal', tone === 'error');
  };

  const start = () => {
    if (retry) clearTimeout(retry);
    retry = null;
    sameCount = 0;
    lastPrint = '';
    // Le service compare l'URL exactement : pas de paramètre anti-cache. Vider la source
    // avant de la remettre suffit à rouvrir une connexion.
    img.removeAttribute('src');
    img.src = STREAM_URL;
  };

  const stop = () => {
    if (retry) clearTimeout(retry);
    retry = null;
    img.removeAttribute('src');
  };

  img.addEventListener('load', () => setState('', ''));
  img.addEventListener('error', () => {
    setState(
      store.phase === 'offline' ? 'Aucune image' : 'Caméra indisponible, nouvelle tentative…',
      'error',
    );
    if (!document.hidden) retry = setTimeout(start, RETRY_MS);
  });

  const freezeTimer = setInterval(() => {
    if (document.hidden || !img.src || !img.naturalWidth) return;
    const fp = fingerprint(img, probeCtx);
    if (fp === null) return;
    sameCount = fp === lastPrint ? sameCount + 1 : 0;
    lastPrint = fp;
    // Deux contrôles identiques (12 s) : la caméra de la CC2 gèle sans couper la connexion.
    if (sameCount >= 2) setState("Flux figé : la caméra ne renvoie plus d'image", 'warn');
    else if (state.classList.contains('warn')) setState('', '');
  }, FREEZE_CHECK_MS);

  const onVisibility = () => (document.hidden ? stop() : start());
  document.addEventListener('visibilitychange', onVisibility);
  const onFs = () =>
    fsBtn.replaceChildren(ico(document.fullscreenElement === root ? 'shrink' : 'expand'));
  document.addEventListener('fullscreenchange', onFs);

  const render = () => {
    const s = store.printer.status;
    const ps = s?.print_status;
    const active = store.isActive || store.phase === 'ended';
    root.classList.toggle('printing', active);
    const offline = store.phase === 'offline';
    live.classList.toggle('off', offline);
    if (offline && !img.naturalWidth) setState('Aucune image', 'error');
    else if (wasOffline && !offline && !document.hidden) start();
    wasOffline = offline;
    setText(phase, store.phaseLabel);
    setText(time, clock(Date.now()));

    setText(title, active && ps?.filename ? prettyFile(ps.filename) : '');
    setText(pct, active ? `${store.progress}%` : '');
    progressFill.style.width = `${active ? store.progress : 0}%`;

    const items: Array<[string, string]> = [];
    if (active) {
      const total = store.totalLayers;
      items.push(['Couche', `${ps?.current_layer ?? 0}${total ? ` / ${total}` : ''}`]);
      items.push(['Restant', duration(ps?.remaining_time_sec)]);
      items.push(['Fin', eta(ps?.remaining_time_sec ?? 0)]);
    }
    items.push([
      'Buse',
      `${temp(s?.extruder?.temperature)}°${s?.extruder?.target ? ` → ${temp(s.extruder.target)}°` : ''}`,
    ]);
    items.push([
      'Plateau',
      `${temp(s?.heater_bed?.temperature)}°${s?.heater_bed?.target ? ` → ${temp(s.heater_bed.target)}°` : ''}`,
    ]);
    items.push(['Caisson', `${temp(s?.ztemperature_sensor?.temperature)}°`]);
    if (active) {
      const mode = SPEED_MODES.find((m) => m.value === s?.gcode_move?.speed_mode);
      if (mode) items.push(['Vitesse', mode.label]);
    }
    const sig = items.map((i) => i.join(':')).join('|');
    if (metrics.dataset.sig !== sig) {
      metrics.dataset.sig = sig;
      metrics.replaceChildren(
        ...items.map(([k, v]) => h('span', { class: 'cam-metric' }, h('em', {}, k), h('b', {}, v))),
      );
    }
  };

  const unsub = store.on(['status', 'connection'], render);
  const clockTimer = setInterval(() => setText(time, clock(Date.now())), 15000);
  render();
  if (!document.hidden) start();

  return {
    el: root,
    destroy() {
      unsub();
      stop();
      clearInterval(freezeTimer);
      clearInterval(clockTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('fullscreenchange', onFs);
    },
  };
}
