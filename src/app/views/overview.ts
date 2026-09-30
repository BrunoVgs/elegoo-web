import { send } from '../commands';
import { eventText } from '../events';
import { ago } from '../format';
import { go } from '../router';
import { store } from '../store';
import { cameraView } from '../ui/camera';
import { liveChart } from '../ui/chart';
import { button, h, panel, segmented, setPressed, switchInput } from '../ui/dom';
import { printCard } from '../ui/print-card';
import { tempsBlock } from '../ui/temps';
import { traysBlock } from '../ui/trays';

const WINDOWS = [
  { value: 300, label: '5 min' },
  { value: 1800, label: '30 min' },
  { value: 3600, label: '1 h' },
];

function withOrder(el: HTMLElement, order: number): HTMLElement {
  el.dataset.order = String(order);
  return el;
}

export default function mount(host: HTMLElement): () => void {
  const cam = cameraView();
  const card = printCard();
  const temps = tempsBlock();
  const trays = traysBlock();
  const chart = liveChart({
    store: store.charts,
    windowSec: 1800,
    unit: '°',
    yMin: 0,
    series: [
      { key: 'nozzle', label: 'Buse', color: '--t-nozzle' },
      { key: 'nozzle_tgt', label: 'Consigne buse', color: '--t-nozzle', dashed: true, quiet: true },
      { key: 'bed', label: 'Plateau', color: '--t-bed' },
      { key: 'bed_tgt', label: 'Consigne plateau', color: '--t-bed', dashed: true, quiet: true },
      { key: 'chamber', label: 'Caisson', color: '--t-chamber' },
    ],
  });
  const windowPicker = segmented(WINDOWS, 1800, (v) => {
    chart.setWindow(v);
    setPressed(windowPicker, v);
  });

  const light = switchInput(
    store.printer.status?.led?.status === 1,
    (on) => void send(1029, { power: on ? 1 : 0 }),
  );
  const lightInput = light.querySelector('input')!;

  const events = h('div', { class: 'list' });
  const renderEvents = () => {
    const items = store.events
      .map((e) => ({ ...e, text: eventText(e.event) }))
      .filter((e) => e.text)
      .slice(-8)
      .reverse();
    events.replaceChildren(
      ...(items.length
        ? items.map((e) =>
            h(
              'div',
              { class: `list-row ev ev-${e.text!.tone}` },
              h('span', { class: 'ev-dot' }),
              h(
                'div',
                { class: 'list-main' },
                h('div', { class: 'list-title' }, e.text!.title),
                e.text!.detail ? h('div', { class: 'list-sub' }, e.text!.detail) : null,
              ),
              h('span', { class: 'hint num' }, ago(e.ts)),
            ),
          )
        : [h('div', { class: 'empty' }, 'Aucun événement')]),
    );
  };

  const syncLight = () => {
    const on = store.printer.status?.led?.status === 1;
    if (lightInput.checked !== on) lightInput.checked = on;
  };

  // Deux colonnes sur grand écran ; sur mobile les colonnes s'effacent et `data-order`
  // remet les panneaux dans l'ordre de lecture (caméra, impression, chauffe…).
  host.append(
    h(
      'div',
      { class: 'grid overview' },
      h(
        'div',
        { class: 'span-8 stack' },
        h('section', { class: 'panel cam-panel', 'data-order': 1 }, cam.el),
        withOrder(panel('Historique des températures', chart.el, { actions: [windowPicker] }), 6),
        withOrder(
          panel('Derniers événements', events, {
            flush: true,
            actions: [button('Journal', { cls: 'ghost', onClick: () => go('journal') })],
          }),
          7,
        ),
      ),
      h(
        'div',
        { class: 'span-4 stack' },
        withOrder(panel('Impression', card.el), 2),
        withOrder(panel('Températures', temps.el), 3),
        withOrder(
          panel('Filaments', trays.el, {
            flush: true,
            actions: [button('Gérer', { cls: 'ghost', onClick: () => go('controle') })],
          }),
          4,
        ),
        withOrder(
          panel(
            'Éclairage',
            h('label', { class: 'row between' }, h('span', {}, 'Lumière du caisson'), light),
          ),
          5,
        ),
      ),
    ),
  );

  const offEvents = store.on('events', renderEvents);
  const offLight = store.on('status', syncLight);
  renderEvents();
  const tick = setInterval(renderEvents, 60_000);

  return () => {
    cam.destroy();
    card.destroy();
    temps.destroy();
    trays.destroy();
    chart.destroy();
    offEvents();
    offLight();
    clearInterval(tick);
  };
}
