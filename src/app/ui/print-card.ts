import { query, send } from '../commands';
import { duration, eta, grams, prettyFile } from '../format';
import { SPEED_MODES } from '../labels';
import { go } from '../router';
import { store } from '../store';
import { button, h, segmented, setPressed, setText } from './dom';
import { confirm } from './modal';

const RING_R = 52;
const RING_C = 2 * Math.PI * RING_R;

export interface PrintCard {
  el: HTMLElement;
  destroy(): void;
}

function ring(): { el: SVGSVGElement; set(pct: number): void } {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('class', 'ring');
  const track = document.createElementNS(ns, 'circle');
  const arc = document.createElementNS(ns, 'circle');
  for (const c of [track, arc]) {
    c.setAttribute('cx', '60');
    c.setAttribute('cy', '60');
    c.setAttribute('r', String(RING_R));
  }
  track.setAttribute('class', 'ring-track');
  arc.setAttribute('class', 'ring-arc');
  arc.setAttribute('stroke-dasharray', String(RING_C));
  svg.append(track, arc);
  return {
    el: svg,
    set(pct: number) {
      arc.setAttribute(
        'stroke-dashoffset',
        String(RING_C * (1 - Math.min(100, Math.max(0, pct)) / 100)),
      );
    },
  };
}

export function printCard(): PrintCard {
  let lastFile = '';
  const thumb = h('img', { class: 'pc-thumb', alt: '' });
  const thumbWrap = h('div', { class: 'pc-thumb-wrap' }, thumb);
  const name = h('div', { class: 'pc-name' });
  const sub = h('div', { class: 'pc-sub' });
  const r = ring();
  const pct = h('div', { class: 'pc-pct num' });
  const layer = h('div', { class: 'pc-layer num' });
  const stats = h('div', { class: 'pc-stats' });
  const statEls: Record<string, HTMLElement> = {};
  for (const [key, label] of [
    ['elapsed', 'Écoulé'],
    ['remaining', 'Restant'],
    ['eta', 'Fin prévue'],
    ['filament', 'Filament'],
  ] as const) {
    statEls[key] = h('b', { class: 'num' });
    stats.append(h('div', { class: 'pc-stat' }, h('span', {}, label), statEls[key]));
  }

  const pauseBtn = button('Pause', {
    icon: 'pause',
    cls: 'warn lg',
    onClick: async (e) => {
      if (
        await confirm("Mettre l'impression en pause", 'La tête se range et la buse reste chaude.', {
          ok: 'Pause',
          tone: 'warn',
        })
      )
        void send(1021, {}, e.currentTarget as HTMLElement);
    },
  });
  const resumeBtn = button('Reprendre', {
    icon: 'play',
    cls: 'ok lg',
    onClick: (e) => void send(1023, {}, e.currentTarget as HTMLElement),
  });
  const stopBtn = button('Arrêter', {
    icon: 'stop',
    cls: 'danger lg',
    onClick: async (e) => {
      const file = prettyFile(store.printer.status?.print_status?.filename ?? '');
      if (
        await confirm(
          "Arrêter l'impression",
          `${file} sera abandonnée. Cette action est définitive.`,
          { ok: 'Arrêter', tone: 'danger' },
        )
      )
        void send(1022, {}, e.currentTarget as HTMLElement);
    },
  });
  const speed = segmented(
    SPEED_MODES.map((m) => ({ value: m.value, label: m.label })),
    null,
    (mode) => void send(1031, { mode }),
    'fill',
  );
  const actions = h('div', { class: 'pc-actions' }, pauseBtn, resumeBtn, stopBtn);
  const speedRow = h('div', { class: 'pc-speed' }, h('span', { class: 'label' }, 'Vitesse'), speed);
  const idleText = h('p', { class: 'muted' });
  const idle = h(
    'div',
    { class: 'pc-idle' },
    idleText,
    button('Parcourir les fichiers', { icon: 'files', onClick: () => go('fichiers') }),
  );

  const el = h(
    'div',
    { class: 'pc' },
    h('div', { class: 'pc-head' }, thumbWrap, h('div', { class: 'pc-title' }, name, sub)),
    h(
      'div',
      { class: 'pc-main' },
      h('div', { class: 'pc-ring' }, r.el, h('div', { class: 'pc-ring-text' }, pct, layer)),
      stats,
    ),
    speedRow,
    actions,
    idle,
  );

  const render = () => {
    const s = store.printer.status;
    const ps = s?.print_status;
    const phase = store.phase;
    const active = store.isActive || phase === 'ended';
    el.classList.toggle('is-idle', !active);
    el.classList.toggle('is-paused', phase === 'paused');

    const file = ps?.filename ?? '';
    if (file && file !== lastFile) {
      lastFile = file;
      store.printer.thumbnail = null;
      store.printer.thumbnailRequestQueue.push('print');
      query(1045, { storage_media: 'local', file_name: file });
      query(1046, { storage_media: 'local', filename: file });
    }
    const offline = phase === 'offline';
    setText(
      name,
      active && file ? prettyFile(file) : offline ? store.phaseLabel : 'Imprimante disponible',
    );
    setText(sub, offline ? '' : store.phaseLabel);
    setText(
      idleText,
      offline
        ? "Aucune donnée pour l'instant : l'état et les commandes reviennent dès la reconnexion."
        : "Aucune impression en cours. Les fichiers de l'imprimante sont prêts à être lancés.",
    );

    const src = store.printer.thumbnail ? `data:image/png;base64,${store.printer.thumbnail}` : '';
    if (active && src && thumb.getAttribute('src') !== src) thumb.src = src;
    thumbWrap.classList.toggle('has-img', active && !!src);

    const progress = active ? store.progress : 0;
    r.set(progress);
    setText(pct, `${progress}%`);
    const total = store.totalLayers;
    setText(layer, active ? `couche ${ps?.current_layer ?? 0}${total ? ` / ${total}` : ''}` : '');

    setText(statEls.elapsed, active ? duration(ps?.print_duration) : '--');
    setText(statEls.remaining, active ? duration(ps?.remaining_time_sec) : '--');
    setText(statEls.eta, active ? eta(ps?.remaining_time_sec ?? 0) : '--');
    const used = store.printer.filamentUsage.reduce((sum, u) => sum + u.grams, 0);
    setText(statEls.filament, active && used ? grams(used) : '--');

    pauseBtn.classList.toggle('hidden', phase !== 'printing');
    resumeBtn.classList.toggle('hidden', phase !== 'paused');
    stopBtn.classList.toggle('hidden', !store.isActive);
    actions.classList.toggle('hidden', !store.isActive);
    speedRow.classList.toggle('hidden', !store.isActive);
    setPressed(speed, s?.gcode_move?.speed_mode ?? null);
  };

  const unsub = store.on(['status', 'thumb', 'connection'], render);
  render();
  return { el, destroy: unsub };
}
