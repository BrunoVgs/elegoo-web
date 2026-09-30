import type { CanvasTray } from '../../types';
import { send } from '../commands';
import { FILAMENTS, type FilamentRow } from '../filament-db';
import { button, h } from './dom';
import { openModal } from './modal';
import { toast } from './toast';

const BRANDS = ['ELEGOO', 'Generic'] as const;
const SWATCHES = [
  '#FFFFFF',
  '#000000',
  '#898989',
  '#FF2A3D',
  '#FF7A1A',
  '#FFF242',
  '#3DDC84',
  '#36A8E1',
  '#1F3FBF',
  '#8E44AD',
  '#F2A7C3',
  '#7A4B2A',
];

function names(brand: string): FilamentRow[] {
  return FILAMENTS.filter((f) => (brand === 'ELEGOO' ? f[5] : f[6]));
}

export function filamentEditor(canvasId: number, tray: CanvasTray): void {
  const brand = h('select', { class: 'select' });
  for (const b of BRANDS) brand.append(h('option', { value: b }, b));
  brand.value = BRANDS.includes(tray.brand as (typeof BRANDS)[number]) ? tray.brand : 'ELEGOO';

  const name = h('select', { class: 'select' });
  const fillNames = () => {
    const keep = name.value || tray.filament_name;
    name.replaceChildren(
      ...names(brand.value).map((f) => h('option', { value: f[0] }, `${f[0]} (${f[3]}-${f[4]}°)`)),
    );
    if ([...name.options].some((o) => o.value === keep)) name.value = keep;
  };
  fillNames();
  brand.addEventListener('change', fillNames);

  const color = h('input', {
    type: 'color',
    class: 'color-input',
    value: (tray.filament_color || '#FFFFFF').slice(0, 7),
  });
  const swatches = h('div', { class: 'swatches' });
  for (const c of SWATCHES) {
    swatches.append(
      h('button', {
        type: 'button',
        class: 'swatch-btn',
        style: `background:${c}`,
        title: c,
        onclick: () => {
          color.value = c.toLowerCase();
        },
      }),
    );
  }

  const body = h(
    'div',
    { class: 'form' },
    h('div', { class: 'field' }, h('label', {}, 'Marque'), brand),
    h('div', { class: 'field' }, h('label', {}, 'Filament'), name),
    h(
      'div',
      { class: 'field' },
      h('label', {}, 'Couleur'),
      h('div', { class: 'row wrap' }, color, swatches),
    ),
  );

  const close = openModal({
    title: `Bobine ${tray.tray_id + 1}`,
    body,
    actions: [
      button('Annuler', { cls: 'ghost', onClick: () => close() }),
      button('Enregistrer', {
        cls: 'primary',
        onClick: async (e) => {
          const def = FILAMENTS.find((f) => f[0] === name.value);
          if (!def) return;
          const code = await send(
            2003,
            {
              canvas_id: canvasId,
              tray_id: tray.tray_id,
              brand: brand.value,
              filament_type: def[1],
              filament_name: def[0],
              filament_code: def[2],
              filament_color: color.value.toUpperCase(),
              filament_min_temp: def[3],
              filament_max_temp: def[4],
            },
            e.currentTarget as HTMLElement,
          );
          if (code === 0) {
            toast('Bobine enregistrée', 'ok');
            close();
          }
        },
      }),
    ],
  });
}
