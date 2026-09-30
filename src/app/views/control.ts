import { send } from '../commands';
import { num } from '../format';
import { SPEED_MODES } from '../labels';
import { store } from '../store';
import { liveChart } from '../ui/chart';
import { button, h, ico, panel, segmented, setPressed, setText, switchInput } from '../ui/dom';
import type { IconName } from '../ui/icons';
import { confirm } from '../ui/modal';
import { type Stepper, stepper } from '../ui/stepper';
import { tempsBlock } from '../ui/temps';
import { traysBlock } from '../ui/trays';

const DISTANCES = [0.1, 1, 10, 50];

const FANS: Array<{ key: 'fan' | 'aux_fan' | 'box_fan'; label: string; hint: string }> = [
  { key: 'fan', label: 'Pièce', hint: 'refroidissement de la couche' },
  { key: 'aux_fan', label: 'Auxiliaire', hint: 'soufflerie latérale' },
  { key: 'box_fan', label: 'Caisson', hint: 'extraction' },
];

const MAINTENANCE: Array<{
  method: number;
  label: string;
  icon: IconName;
  text: string;
  params?: Record<string, unknown>;
}> = [
  {
    method: 1032,
    label: 'Nivellement',
    icon: 'grid',
    text: 'Palpage complet du plateau. Le plateau doit être vide et propre.',
  },
  {
    method: 1034,
    label: 'Calibration PID',
    icon: 'thermo',
    text: 'Chauffe et mesure de la buse et du plateau pour régler la régulation.',
  },
  {
    method: 1033,
    label: 'Vibrations',
    icon: 'gauge',
    text: 'Test de résonance (input shaping) : la tête vibre à différentes fréquences.',
  },
  {
    method: 1035,
    label: 'Auto-diagnostic',
    icon: 'wrench',
    text: 'Enchaîne nivellement, optimisation des vibrations et calibration PID.',
    params: { ringing_optimize: true, pid_check: true, auto_bed_leveling: true },
  },
];

function pctFrom255(v: number | undefined): number {
  return Math.round(((v ?? 0) / 255) * 100);
}

export default function mount(host: HTMLElement): () => void {
  let distance = 10;
  const cleanups: Array<() => void> = [];

  /* ---- déplacement ---- */

  const move = (axis: 'x' | 'y' | 'z', dir: number) => (e: Event) =>
    void send(1027, { axes: axis, distance: distance * dir }, e.currentTarget as HTMLElement);

  const jogBtn = (label: string, icn: IconName, onClick: (e: Event) => void, cls = '') =>
    h(
      'button',
      {
        type: 'button',
        class: `jog-btn ${cls}`.trim(),
        title: label,
        'aria-label': label,
        onclick: onClick,
      },
      ico(icn),
    );

  const home = (axes: string, label: string) => async (e: Event) => {
    const btn = e.currentTarget as HTMLElement;
    if (
      await confirm(
        `Origine ${label}`,
        'La tête et le plateau vont se déplacer. Vérifier que rien ne gêne.',
        { ok: 'Lancer' },
      )
    )
      void send(1026, { homed_axes: axes }, btn);
  };

  const pad = h(
    'div',
    { class: 'jog-pad' },
    h('span'),
    jogBtn('Y+ (arrière)', 'up', move('y', 1)),
    h('span'),
    jogBtn('X-', 'left', move('x', -1)),
    jogBtn('Origine XY', 'home', home('xy', 'XY'), 'home'),
    jogBtn('X+', 'right', move('x', 1)),
    h('span'),
    jogBtn('Y- (avant)', 'down', move('y', -1)),
    h('span'),
  );
  const zcol = h(
    'div',
    { class: 'jog-z' },
    jogBtn('Z+ (plateau descend)', 'chevronsUp', move('z', 1)),
    jogBtn('Origine Z', 'home', home('z', 'Z'), 'home'),
    jogBtn('Z- (plateau monte)', 'chevronsDown', move('z', -1)),
  );
  const distPicker = segmented(
    DISTANCES.map((d) => ({ value: d, label: `${String(d).replace('.', ',')} mm` })),
    distance,
    (d) => {
      distance = d;
      setPressed(distPicker, d);
    },
    'fill',
  );
  const pos: Record<'x' | 'y' | 'z', HTMLElement> = {
    x: h('b', { class: 'num' }),
    y: h('b', { class: 'num' }),
    z: h('b', { class: 'num' }),
  };
  const homed: Record<'x' | 'y' | 'z', HTMLElement> = { x: h('i'), y: h('i'), z: h('i') };
  const posRow = h(
    'div',
    { class: 'pos-row' },
    ...(['x', 'y', 'z'] as const).map((a) =>
      h('span', { class: 'pos' }, homed[a], a.toUpperCase(), pos[a]),
    ),
  );
  const moveLock = h(
    'div',
    { class: 'lock-note' },
    ico('alert'),
    "Déplacements désactivés pendant l'impression",
  );
  const moveBody = h(
    'div',
    { class: 'jog' },
    h('div', { class: 'jog-main' }, pad, zcol),
    distPicker,
    posRow,
    button('Origine complète XYZ', { icon: 'home', cls: 'block', onClick: home('xyz', 'XYZ') }),
    moveLock,
  );

  /* ---- ventilation ---- */

  const fanRows: Array<{ key: string; step: Stepper; bar: HTMLElement; value: HTMLElement }> = [];
  const fanList = h('div', { class: 'fans' });
  for (const fan of FANS) {
    const value = h('span', { class: 'num fan-val' });
    const bar = h('span');
    const step = stepper({
      value: 0,
      min: 0,
      max: 100,
      step: 10,
      bigStep: 25,
      unit: '%',
      onCommit: (v) => void send(1030, { [fan.key]: Math.round((v / 100) * 255) }),
    });
    fanList.append(
      h(
        'div',
        { class: 'fan-row' },
        h(
          'div',
          { class: 'fan-head' },
          h('span', { class: 'fan-name' }, ico('fan'), fan.label),
          h('span', { class: 'hint' }, fan.hint),
          value,
        ),
        h('div', { class: 'row' }, h('div', { class: 'bar fan-bar' }, bar), step.el),
      ),
    );
    fanRows.push({ key: fan.key, step, bar, value });
  }
  const sysFans = h('div', { class: 'hint sys-fans num' });
  const fanChart = liveChart({
    store: store.charts,
    windowSec: 900,
    unit: '%',
    yMin: 0,
    yMax: 100,
    height: 120,
    series: [
      { key: 'fan_model', label: 'Pièce', color: '--info' },
      { key: 'fan_aux', label: 'Auxiliaire', color: '--ok' },
      { key: 'fan_case', label: 'Caisson', color: '--warn' },
    ],
  });
  cleanups.push(fanChart.destroy);

  /* ---- vitesse et lumière ---- */

  const speed = segmented(
    SPEED_MODES.map((m) => ({ value: m.value, label: `${m.label} ${m.pct}%` })),
    null,
    (mode) => void send(1031, { mode }),
    'fill',
  );
  const light = switchInput(false, (on) => void send(1029, { power: on ? 1 : 0 }));
  const lightInput = light.querySelector('input')!;

  /* ---- maintenance ---- */

  const maintButtons: HTMLButtonElement[] = [];
  const maint = h('div', { class: 'maint' });
  for (const m of MAINTENANCE) {
    const b = h(
      'button',
      {
        type: 'button',
        class: 'maint-btn',
        onclick: async (e: Event) => {
          const btn = e.currentTarget as HTMLElement;
          if (await confirm(m.label, m.text, { ok: 'Lancer' }))
            void send(m.method, m.params ?? {}, btn);
        },
      },
      ico(m.icon),
      h('span', {}, m.label),
    );
    maintButtons.push(b);
    maint.append(b);
  }

  const temps = tempsBlock();
  const trays = traysBlock({ editable: true });
  cleanups.push(temps.destroy, trays.destroy);

  host.append(
    h(
      'div',
      { class: 'grid control' },
      h(
        'div',
        { class: 'span-4 stack' },
        panel('Déplacement', moveBody),
        panel('Vitesse', speed),
        panel(
          'Éclairage',
          h('label', { class: 'row between' }, h('span', {}, 'Lumière du caisson'), light),
        ),
      ),
      h(
        'div',
        { class: 'span-4 stack' },
        panel('Chauffe', temps.el),
        panel('Ventilation', h('div', {}, fanList, sysFans, fanChart.el)),
      ),
      h(
        'div',
        { class: 'span-4 stack' },
        panel('Filaments', trays.el, { flush: true }),
        panel('Maintenance', maint),
      ),
    ),
  );

  const render = () => {
    const s = store.printer.status;
    const busy = store.isActive || store.phase === 'offline';
    moveBody.classList.toggle('locked', busy);
    for (const b of moveBody.querySelectorAll<HTMLButtonElement>('button')) b.disabled = busy;
    for (const b of maintButtons) b.disabled = busy || store.phase === 'busy';
    const gm = s?.gcode_move;
    const axes = s?.tool_head?.homed_axes ?? '';
    for (const a of ['x', 'y', 'z'] as const) {
      setText(pos[a], num(gm?.[a], 1));
      homed[a].className = axes.includes(a) ? 'homed' : '';
      homed[a].title = axes.includes(a) ? 'origine faite' : 'origine à faire';
    }
    for (const r of fanRows) {
      const pct = pctFrom255(s?.fans?.[r.key as 'fan']?.speed);
      setText(r.value, `${pct}%`);
      r.bar.style.width = `${pct}%`;
      r.step.sync(pct);
    }
    setText(
      sysFans,
      `Carte mère ${pctFrom255(s?.fans?.controller_fan?.speed)}% · heatbreak ${pctFrom255(s?.fans?.heater_fan?.speed)}%`,
    );
    setPressed(speed, gm?.speed_mode ?? null);
    const on = s?.led?.status === 1;
    if (lightInput.checked !== on) lightInput.checked = on;
  };
  cleanups.push(store.on(['status', 'connection'], render));
  render();

  return () => {
    for (const c of cleanups) c();
  };
}
