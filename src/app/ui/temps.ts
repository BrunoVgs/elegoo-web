import { send } from '../commands';
import { temp } from '../format';
import { store } from '../store';
import { h, setText } from './dom';
import { type Stepper, stepper } from './stepper';

const PRESETS = [
  { label: 'PLA', nozzle: 210, bed: 60 },
  { label: 'PETG', nozzle: 240, bed: 80 },
  { label: 'ABS', nozzle: 255, bed: 100 },
  { label: 'TPU', nozzle: 225, bed: 50 },
];

interface Heater {
  key: 'extruder' | 'heater_bed';
  label: string;
  color: string;
  max: number;
}

const HEATERS: Heater[] = [
  { key: 'extruder', label: 'Buse', color: 'var(--t-nozzle)', max: 320 },
  { key: 'heater_bed', label: 'Plateau', color: 'var(--t-bed)', max: 110 },
];

export interface TempsBlock {
  el: HTMLElement;
  destroy(): void;
}

export function tempsBlock(): TempsBlock {
  const rows: Array<{
    heater: Heater;
    value: HTMLElement;
    target: HTMLElement;
    fill: HTMLElement;
    step: Stepper;
  }> = [];

  const list = h('div', { class: 'temps' });
  for (const heater of HEATERS) {
    const value = h('span', { class: 'temp-now num' });
    const target = h('span', { class: 'temp-target num' });
    const fill = h('span', { style: `background:${heater.color}` });
    const step = stepper({
      value: 0,
      min: 0,
      max: heater.max,
      step: 5,
      bigStep: 20,
      unit: '°C',
      onCommit: (v) => void send(1028, { [heater.key]: v }),
    });
    const off = h(
      'button',
      {
        type: 'button',
        class: 'btn ghost',
        title: 'Couper la chauffe',
        onclick: () => {
          step.sync(0);
          void send(1028, { [heater.key]: 0 });
        },
      },
      'Off',
    );
    list.append(
      h(
        'div',
        { class: 'temp-row' },
        h(
          'div',
          { class: 'temp-head' },
          h('span', { class: 'temp-name', style: `--c:${heater.color}` }, heater.label),
          value,
          target,
        ),
        h('div', { class: 'temp-ctl' }, step.el, off),
        h('div', { class: 'bar thin temp-bar' }, fill),
      ),
    );
    rows.push({ heater, value, target, fill, step });
  }

  const chamberValue = h('span', { class: 'temp-now num' });
  list.append(
    h(
      'div',
      { class: 'temp-row chamber' },
      h(
        'div',
        { class: 'temp-head' },
        h('span', { class: 'temp-name', style: '--c:var(--t-chamber)' }, 'Caisson'),
        chamberValue,
      ),
    ),
  );

  const presets = h(
    'div',
    { class: 'row wrap temp-presets' },
    h('span', { class: 'label' }, 'Préchauffe'),
  );
  for (const p of PRESETS) {
    presets.append(
      h(
        'button',
        {
          type: 'button',
          class: 'btn',
          title: `Buse ${p.nozzle}° / plateau ${p.bed}°`,
          onclick: (e: Event) =>
            void send(
              1028,
              { extruder: p.nozzle, heater_bed: p.bed },
              e.currentTarget as HTMLElement,
            ),
        },
        p.label,
      ),
    );
  }
  presets.append(
    h(
      'button',
      {
        type: 'button',
        class: 'btn ghost',
        onclick: (e: Event) =>
          void send(1028, { extruder: 0, heater_bed: 0 }, e.currentTarget as HTMLElement),
      },
      'Tout couper',
    ),
  );

  const render = () => {
    const s = store.printer.status;
    for (const r of rows) {
      const src = s?.[r.heater.key];
      const cur = src?.temperature;
      const tgt = src?.target ?? 0;
      setText(r.value, `${temp(cur)}°`);
      setText(r.target, tgt ? `→ ${temp(tgt)}°` : 'éteint');
      r.target.classList.toggle('heating', !!tgt && (cur ?? 0) < tgt - 2);
      r.fill.style.width = `${Math.min(100, ((cur ?? 0) / r.heater.max) * 100)}%`;
      r.step.sync(Math.round(tgt));
    }
    setText(chamberValue, `${temp(s?.ztemperature_sensor?.temperature)}°`);
  };

  const unsub = store.on('status', render);
  render();

  return { el: h('div', {}, list, presets), destroy: unsub };
}
