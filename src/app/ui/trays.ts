import type { CanvasTray } from '../../types';
import { send } from '../commands';
import { store } from '../store';
import { button, h, switchInput } from './dom';
import { filamentEditor } from './filament-editor';
import { confirm } from './modal';

export interface TraysBlock {
  el: HTMLElement;
  destroy(): void;
}

function trayTone(color: string): string {
  const hex = color.replace('#', '');
  if (hex.length < 6) return '#fff';
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return r * 0.299 + g * 0.587 + b * 0.114 > 150 ? '#111' : '#fff';
}

/**
 * Bobines du Canvas. `editable` ajoute charger / décharger / modifier, réservés à la
 * vue Contrôle : sur l'accueil, un clic sur une bobine ne doit rien déclencher.
 */
export function traysBlock(opts: { editable?: boolean } = {}): TraysBlock {
  const root = h('div', { class: 'trays-wrap' });

  const render = () => {
    const canvas = store.printer.canvas;
    const units = canvas?.canvas_list?.filter((u) => u.connected) ?? [];
    const busy = store.isActive;
    const sig = JSON.stringify([
      canvas?.active_tray_id,
      canvas?.active_canvas_id,
      canvas?.auto_refill,
      units,
      busy,
      store.printer.filamentUsage.length,
    ]);
    if (root.dataset.sig === sig) return;
    root.dataset.sig = sig;

    if (!units.length) {
      root.replaceChildren(h('div', { class: 'empty' }, 'Aucun Canvas connecté'));
      return;
    }

    const blocks: Node[] = [];
    for (const unit of units) {
      const grid = h('div', { class: 'trays' });
      for (const tray of unit.tray_list) {
        grid.append(
          trayCard(
            unit.canvas_id,
            tray,
            canvas!.active_canvas_id === unit.canvas_id && canvas!.active_tray_id === tray.tray_id,
            busy,
          ),
        );
      }
      blocks.push(grid);
    }
    if (opts.editable) {
      blocks.push(
        h(
          'label',
          { class: 'row tray-refill' },
          switchInput(!!canvas?.auto_refill, (on) => void send(2004, { auto_refill: on })),
          h('span', {}, 'Recharge automatique'),
          h('span', { class: 'hint' }, "bascule sur une bobine identique quand l'une est vide"),
        ),
      );
    }
    root.replaceChildren(...blocks);
  };

  const trayCard = (
    canvasId: number,
    tray: CanvasTray,
    active: boolean,
    busy: boolean,
  ): HTMLElement => {
    const empty = tray.status === 0;
    const color = empty ? 'transparent' : tray.filament_color || '#888';
    const usage = store.printer.filamentUsage.find(
      (u) => u.trayKey === `canvas_${canvasId}_tray_${tray.tray_id}`,
    );
    const card = h(
      'div',
      { class: `tray ${active ? 'active' : ''} ${empty ? 'empty-tray' : ''}`.trim() },
      h(
        'div',
        { class: 'tray-color', style: `background:${color};color:${trayTone(color)}` },
        h('span', { class: 'tray-num' }, String(tray.tray_id + 1)),
        active ? h('span', { class: 'tray-active' }, 'actif') : null,
      ),
      h(
        'div',
        { class: 'tray-info' },
        h('div', { class: 'tray-name' }, empty ? 'Vide' : tray.filament_name || tray.filament_type),
        h(
          'div',
          { class: 'tray-sub' },
          empty ? '' : `${tray.brand} · ${tray.min_nozzle_temp}-${tray.max_nozzle_temp}°`,
        ),
        usage ? h('div', { class: 'tray-sub num' }, `${usage.grams.toFixed(1)} g utilisés`) : null,
      ),
    );
    if (!opts.editable) return card;

    const actions = h('div', { class: 'tray-actions' });
    actions.append(
      button('', {
        icon: 'settings',
        cls: 'ghost',
        title: 'Modifier le filament',
        onClick: () => filamentEditor(canvasId, tray),
      }),
    );
    if (!empty && !busy) {
      actions.append(
        button(active ? 'Décharger' : 'Charger', {
          cls: 'ghost',
          onClick: async (e) => {
            const btn = e.currentTarget as HTMLElement;
            const verb = active ? 'Décharger' : 'Charger';
            const ok = await confirm(
              `${verb} la bobine ${tray.tray_id + 1}`,
              active
                ? 'La buse chauffe, le filament est coupé puis rétracté dans le Canvas.'
                : 'La buse chauffe, le filament en place est coupé, puis celui-ci est chargé et purgé.',
              { ok: verb },
            );
            if (ok)
              void send(active ? 2002 : 2001, { canvas_id: canvasId, tray_id: tray.tray_id }, btn);
          },
        }),
      );
    }
    card.append(actions);
    return card;
  };

  const unsub = store.on('status', render);
  render();
  return { el: root, destroy: unsub };
}
