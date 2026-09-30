import type { CanvasInfo, CanvasTray } from '../../types';
import { postJson, send } from '../commands';
import { duration, grams, prettyFile } from '../format';
import { store } from '../store';
import { button, h, segmented, setPressed, switchInput } from './dom';
import { openModal } from './modal';
import { toast } from './toast';

export interface PrintTarget {
  /** Chemin complet sur l'imprimante, tel qu'attendu par 1020. */
  path: string;
  source: 'local' | 'u-disk';
  thumbUrl?: string;
  printTime?: number;
  filament?: number;
  layers?: number;
  colorMap?: Array<{ t: number; color: string; name: string }>;
  /** Démarrage par la file du service : elle revérifie l'état avant d'envoyer. */
  queueId?: string;
}

interface Slot {
  canvasId: number;
  tray: CanvasTray;
}

function slots(canvas: CanvasInfo | null): Slot[] {
  const out: Slot[] = [];
  for (const unit of canvas?.canvas_list ?? []) {
    if (!unit.connected) continue;
    for (const tray of unit.tray_list)
      if (tray.status !== 0) out.push({ canvasId: unit.canvas_id, tray });
  }
  return out;
}

function rgb(hex: string): [number, number, number] {
  const c = hex.replace('#', '').padEnd(6, '0');
  return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
}

function distance(a: string, b: string): number {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

/** Associe chaque couleur du G-code à la bobine la plus proche (même matière d'abord). */
function autoMap(
  colors: NonNullable<PrintTarget['colorMap']>,
  available: Slot[],
): Array<Slot | null> {
  const used = new Set<Slot>();
  return colors.map((c) => {
    let best: Slot | null = null;
    let bestScore = Infinity;
    for (const s of available) {
      if (used.has(s)) continue;
      const score =
        distance(c.color, s.tray.filament_color) +
        (s.tray.filament_type.toUpperCase() === c.name.toUpperCase() ? 0 : 100);
      if (score < bestScore) {
        bestScore = score;
        best = s;
      }
    }
    if (best) used.add(best);
    return best;
  });
}

export function openPrintDialog(target: PrintTarget): void {
  const available = slots(store.printer.canvas);
  const colors = target.colorMap ?? [];
  const mapping = available.length && colors.length ? autoMap(colors, available) : [];
  let leveling = true;
  let timelapse = false;
  let plate: 'A' | 'B' = 'A';
  let bedClear = false;

  const mapRows = colors.map((c, i) => {
    const select = h('select', { class: 'select' });
    for (const [idx, s] of available.entries()) {
      select.append(
        h(
          'option',
          { value: String(idx) },
          `Bobine ${s.tray.tray_id + 1} : ${s.tray.filament_name || s.tray.filament_type}`,
        ),
      );
    }
    const pick = mapping[i];
    if (pick) select.value = String(available.indexOf(pick));
    const trayChip = h('span', { class: 'swatch lg' });
    const syncChip = () => {
      const s = available[Number(select.value)];
      trayChip.style.background = s?.tray.filament_color ?? 'transparent';
      mapping[i] = s ?? null;
    };
    select.addEventListener('change', syncChip);
    syncChip();
    return h(
      'div',
      { class: 'map-row' },
      h('span', { class: 'swatch lg', style: `background:${c.color}` }),
      h('span', { class: 'map-name' }, `T${c.t} ${c.name}`),
      h('span', { class: 'map-arrow' }, '→'),
      trayChip,
      select,
    );
  });

  const startBtn = button('Lancer', { cls: 'primary', icon: 'play' });
  startBtn.disabled = true;

  const plateGroup = segmented(
    [
      { value: 'A', label: 'Texturée (A)' },
      { value: 'B', label: 'Lisse (B)' },
    ],
    plate,
    (v) => {
      plate = v as 'A' | 'B';
      setPressed(plateGroup, v);
    },
  );

  const body = h(
    'div',
    { class: 'print-dialog' },
    h(
      'div',
      { class: 'pd-head' },
      target.thumbUrl ? h('img', { class: 'pd-thumb', src: target.thumbUrl, alt: '' }) : null,
      h(
        'div',
        {},
        h('div', { class: 'pd-name' }, prettyFile(target.path)),
        h(
          'div',
          { class: 'list-sub' },
          target.printTime ? h('span', {}, duration(target.printTime)) : null,
          target.filament ? h('span', {}, grams(target.filament)) : null,
          target.layers ? h('span', {}, `${target.layers} couches`) : null,
        ),
      ),
    ),
    mapRows.length
      ? h('div', { class: 'pd-section' }, h('div', { class: 'label' }, 'Filaments'), ...mapRows)
      : null,
    h(
      'div',
      { class: 'pd-section pd-options' },
      h(
        'label',
        { class: 'row between' },
        h('span', {}, 'Nivellement avant impression'),
        switchInput(leveling, (v) => (leveling = v)),
      ),
      h(
        'label',
        { class: 'row between' },
        h('span', {}, 'Timelapse'),
        switchInput(timelapse, (v) => (timelapse = v)),
      ),
      h('div', { class: 'row between' }, h('span', {}, 'Plaque'), plateGroup),
    ),
    h(
      'label',
      { class: 'pd-confirm row' },
      switchInput(false, (v) => {
        bedClear = v;
        startBtn.disabled = !v;
      }),
      h('span', {}, 'Le plateau est vide et propre'),
    ),
  );

  const close = openModal({
    title: target.queueId ? 'Lancer le travail suivant' : 'Lancer une impression',
    body,
    wide: mapRows.length > 0,
    actions: [button('Annuler', { cls: 'ghost', onClick: () => close() }), startBtn],
  });

  startBtn.addEventListener('click', async () => {
    if (!bedClear) return;
    if (mapRows.length && mapping.some((m) => !m)) {
      toast('Chaque couleur doit être associée à une bobine', 'warn');
      return;
    }
    const config = {
      delay_video: timelapse,
      printer_check: leveling,
      print_layout: plate,
      bedlevel_force: false,
      slot_map: mapping.map((m, i) => ({
        t: colors[i].t,
        canvas_id: m!.canvasId,
        tray_id: m!.tray.tray_id,
      })),
    };
    if (target.queueId) {
      try {
        const res = await postJson<{ ok: boolean; error?: string }>('/api/queue/start-next', {
          id: target.queueId,
          bedCleared: true,
          config,
        });
        if (!res.ok) throw new Error(res.error);
        toast("Travail envoyé à l'imprimante", 'ok');
        close();
      } catch (err) {
        toast(`Démarrage refusé : ${(err as Error).message}`, 'error');
      }
      return;
    }
    const code = await send(
      1020,
      { storage_media: target.source, filename: target.path, config },
      startBtn,
    );
    if (code === 0) {
      toast('Impression lancée', 'ok');
      close();
    }
  });
}
