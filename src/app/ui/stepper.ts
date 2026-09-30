import { h, ico } from './dom';

export interface Stepper {
  el: HTMLElement;
  /** Valeur reçue de la machine ; ignorée tant qu'une saisie est en cours. */
  sync(value: number): void;
}

interface StepperOptions {
  value: number;
  min: number;
  max: number;
  step: number;
  /** Pas du clic long / Maj+clic. */
  bigStep?: number;
  unit?: string;
  /** Délai de regroupement : plusieurs clics rapprochés donnent une seule commande. */
  settleMs?: number;
  onCommit: (value: number) => void;
}

export function stepper(opts: StepperOptions): Stepper {
  const settle = opts.settleMs ?? 650;
  let value = opts.value;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let repeat: ReturnType<typeof setInterval> | null = null;

  const input = h('input', {
    type: 'number',
    inputmode: 'numeric',
    min: opts.min,
    max: opts.max,
    step: opts.step,
    'aria-label': opts.unit ?? 'valeur',
  });
  input.value = String(value);

  const clamp = (v: number) =>
    Math.min(opts.max, Math.max(opts.min, Math.round(v / opts.step) * opts.step));

  const commit = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    dirty = false;
    opts.onCommit(value);
  };

  const schedule = () => {
    dirty = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(commit, settle);
  };

  const bump = (dir: number, big: boolean) => {
    value = clamp(value + dir * (big ? (opts.bigStep ?? opts.step * 5) : opts.step));
    input.value = String(value);
    schedule();
  };

  const makeBtn = (dir: number) => {
    const b = h(
      'button',
      { type: 'button', 'aria-label': dir > 0 ? 'Plus' : 'Moins' },
      ico(dir > 0 ? 'plus' : 'minus'),
    );
    b.addEventListener('click', (e) => {
      if (e.detail === 0 || !repeat) bump(dir, e.shiftKey);
    });
    // Appui prolongé : incrément rapide au gros pas.
    b.addEventListener('pointerdown', () => {
      const start = setTimeout(() => {
        repeat = setInterval(() => bump(dir, true), 160);
      }, 450);
      const stop = () => {
        clearTimeout(start);
        if (repeat) {
          clearInterval(repeat);
          setTimeout(() => (repeat = null), 0);
        }
        window.removeEventListener('pointerup', stop);
        window.removeEventListener('pointercancel', stop);
      };
      window.addEventListener('pointerup', stop);
      window.addEventListener('pointercancel', stop);
    });
    return b;
  };

  input.addEventListener('focus', () => {
    dirty = true;
    input.select();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') {
      dirty = false;
      input.blur();
    }
  });
  input.addEventListener('blur', () => {
    const v = Number(input.value);
    if (!dirty) return;
    if (Number.isFinite(v)) {
      value = clamp(v);
      input.value = String(value);
      commit();
    } else {
      dirty = false;
    }
  });

  const el = h('div', { class: 'stepper' }, makeBtn(-1), input, makeBtn(1));

  return {
    el,
    sync(v: number) {
      if (dirty || document.activeElement === input) return;
      value = v;
      if (input.value !== String(v)) input.value = String(v);
    },
  };
}
