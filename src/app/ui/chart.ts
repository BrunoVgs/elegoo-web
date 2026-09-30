import type { ChartStore } from '../../chart-store';
import { clock } from '../format';
import { h } from './dom';

export interface SeriesSpec {
  key: string;
  label: string;
  color: string;
  dashed?: boolean;
  /** Masquée de la légende (courbe de consigne, par exemple). */
  quiet?: boolean;
}

interface ChartOptions {
  store: ChartStore;
  series: SeriesSpec[];
  windowSec: number;
  unit: string;
  yMin?: number;
  yMax?: number;
  height?: number;
}

export interface LiveChart {
  el: HTMLElement;
  setWindow(sec: number): void;
  destroy(): void;
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function resolveColor(color: string): string {
  return color.startsWith('--') ? cssVar(color) : color;
}

/** Courbes temps réel sur canvas, redessinées au plus une fois par seconde. */
export function liveChart(opts: ChartOptions): LiveChart {
  let windowSec = opts.windowSec;
  let hoverX: number | null = null;
  let lastDraw = 0;
  let raf = 0;

  const canvas = h('canvas', { class: 'chart', style: `height:${opts.height ?? 180}px` });
  const legend = h('div', { class: 'legend' });
  for (const s of opts.series) {
    if (s.quiet) continue;
    const i = h('i', { style: `background:${resolveColor(s.color)}` });
    legend.append(
      h(
        'span',
        { 'data-key': s.key },
        i,
        s.label,
        h('b', { class: 'num', style: 'margin-left:6px;font-weight:600' }),
      ),
    );
  }
  const el = h('div', { class: 'chart-wrap' }, canvas, legend);

  const draw = () => {
    raf = 0;
    lastDraw = Date.now();
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 10) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(rect.width * dpr);
    const H = Math.round(rect.height * dpr);
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = rect.width;
    const hgt = rect.height;
    ctx.clearRect(0, 0, w, hgt);

    const now = Date.now();
    const t0 = now - windowSec * 1000;
    const padL = 34;
    const padR = 8;
    const padT = 8;
    const padB = 18;
    const plotW = w - padL - padR;
    const plotH = hgt - padT - padB;

    let lo = opts.yMin ?? Infinity;
    let hi = opts.yMax ?? -Infinity;
    const visible = opts.series.map((s) => {
      const data = (opts.store.getSeries(s.key)?.data ?? []).filter((p) => p.t >= t0);
      if (opts.yMin === undefined || opts.yMax === undefined) {
        for (const p of data) {
          if (opts.yMin === undefined) lo = Math.min(lo, p.v);
          if (opts.yMax === undefined) hi = Math.max(hi, p.v);
        }
      }
      return { spec: s, data };
    });
    if (!Number.isFinite(lo)) lo = 0;
    if (!Number.isFinite(hi) || hi <= lo) hi = lo + 10;
    if (opts.yMax === undefined) hi += (hi - lo) * 0.08;

    const x = (t: number) => padL + ((t - t0) / (windowSec * 1000)) * plotW;
    const y = (v: number) => padT + plotH - ((v - lo) / (hi - lo)) * plotH;

    const grid = cssVar('--border');
    const muted = cssVar('--muted');
    ctx.font = '10.5px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = muted;
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const v = lo + ((hi - lo) * i) / 4;
      const yy = Math.round(y(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(padL, yy);
      ctx.lineTo(w - padR, yy);
      ctx.stroke();
      ctx.fillText(`${Math.round(v)}`, padL - 6, yy);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let i = 0; i <= 4; i++) {
      const t = t0 + (windowSec * 1000 * i) / 4;
      ctx.fillText(clock(t), Math.min(w - padR - 16, Math.max(padL + 16, x(t))), hgt - padB + 4);
    }

    for (const { spec, data } of visible) {
      if (data.length < 2) continue;
      ctx.strokeStyle = resolveColor(spec.color);
      ctx.lineWidth = spec.dashed ? 1 : 1.6;
      ctx.setLineDash(spec.dashed ? [4, 4] : []);
      ctx.beginPath();
      // Décimation : au plus un point par pixel.
      const stride = Math.max(1, Math.floor(data.length / plotW));
      for (let i = 0; i < data.length; i += stride) {
        const p = data[i];
        if (i === 0) ctx.moveTo(x(p.t), y(p.v));
        else ctx.lineTo(x(p.t), y(p.v));
      }
      const last = data[data.length - 1];
      ctx.lineTo(x(last.t), y(last.v));
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Valeurs affichées : au survol, sinon la dernière mesure.
    const tHover = hoverX === null ? null : t0 + ((hoverX - padL) / plotW) * windowSec * 1000;
    if (tHover !== null && hoverX! >= padL) {
      ctx.strokeStyle = muted;
      ctx.beginPath();
      ctx.moveTo(Math.round(hoverX!) + 0.5, padT);
      ctx.lineTo(Math.round(hoverX!) + 0.5, padT + plotH);
      ctx.stroke();
    }
    for (const { spec, data } of visible) {
      const out = legend.querySelector(`[data-key="${spec.key}"] b`);
      if (!out) continue;
      let point = data[data.length - 1];
      if (tHover !== null && data.length) {
        point = data.reduce(
          (best, p) => (Math.abs(p.t - tHover) < Math.abs(best.t - tHover) ? p : best),
          data[0],
        );
      }
      out.textContent = point ? `${Math.round(point.v * 10) / 10}${opts.unit}` : '';
    }
  };

  const request = (force = false) => {
    if (raf) return;
    if (!force && Date.now() - lastDraw < 1000) return;
    raf = requestAnimationFrame(draw);
  };

  canvas.addEventListener('pointermove', (e) => {
    hoverX = e.offsetX;
    request(true);
  });
  canvas.addEventListener('pointerleave', () => {
    hoverX = null;
    request(true);
  });

  const unsub = opts.store.subscribe(() => request());
  const ro = new ResizeObserver(() => request(true));
  ro.observe(canvas);
  request(true);

  return {
    el,
    setWindow(sec: number) {
      windowSec = sec;
      request(true);
    },
    destroy() {
      unsub();
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    },
  };
}
