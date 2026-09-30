import { WebGLPreview } from 'gcode-preview';
import { ConeGeometry, Mesh, MeshBasicMaterial } from 'three';
import type { FileEntry } from '../../types';
import { bytes, duration, num, prettyFile } from '../format';
import { store } from '../store';
import { button, h, ico, iconButton, panel, setText } from '../ui/dom';
import { fileUrl } from '../ui/library';
import { toast } from '../ui/toast';

const BUILD = { x: 256, y: 256, z: 256, smallGrid: false };
const CAMERA_HOME = [210, 330, 250];
/** Taille des tranches confiées au parseur, et fréquence des rendus intermédiaires. */
const CHUNK_BYTES = 1 << 20;
const RENDER_EVERY_BYTES = 6 << 20;

type Source = 'local' | 'u-disk' | 'library';

interface Loaded {
  path: string;
  source: Source;
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function readParams(): { file: string | null; source: Source } {
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const source = q.get('source');
  return {
    file: q.get('file'),
    source: source === 'u-disk' || source === 'library' ? source : 'local',
  };
}

function extrusionColors(colorMap: Array<{ t: number; color: string }>): string | string[] {
  if (!colorMap.length) return cssVar('--brand') || '#ff2a3d';
  if (colorMap.length === 1) return colorMap[0].color;
  const out: string[] = [];
  for (const c of colorMap) out[c.t] = c.color;
  return Array.from(out, (c) => c ?? '#888888');
}

export default function mount(host: HTMLElement): () => void {
  let preview: WebGLPreview | null = null;
  let loaded: Loaded | null = null;
  let abort: AbortController | null = null;
  let follow = true;
  let single = false;
  let layer = 0;
  let nozzle: Mesh | null = null;

  const canvas = h('canvas', { class: 'gc-canvas' });
  const overlay = h('div', { class: 'gc-overlay' });
  const loadFill = h('span');
  const loadText = h('span', { class: 'num' });
  const loadCancel = button('Annuler', { cls: 'ghost', onClick: () => abort?.abort() });
  const loadBox = h(
    'div',
    { class: 'gc-load hidden' },
    h('div', { class: 'bar' }, loadFill),
    h('div', { class: 'row between' }, loadText, loadCancel),
  );
  const stageEl = h('div', { class: 'gc-stage' }, canvas, overlay, loadBox);

  const title = h('div', { class: 'gc-title' });
  const followBtn = button('Suivre', {
    icon: 'crosshair',
    cls: 'ghost',
    title: "Suivre la couche en cours d'impression",
    onClick: () => setFollow(!follow),
  });
  const singleBtn = button('Couche seule', {
    icon: 'layers',
    cls: 'ghost',
    onClick: () => setSingle(!single),
  });
  const fileInput = h('input', { type: 'file', accept: '.gcode,.gco,.g', hidden: true });
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (f) void loadStream(f.stream(), f.size, { path: f.name, source: 'local' }, []);
  });

  const slider = h('input', {
    type: 'range',
    class: 'range',
    min: 1,
    max: 1,
    value: 1,
    'aria-label': 'Couche',
  });
  const layerLabel = h('span', { class: 'gc-layer num' });
  const zLabel = h('span', { class: 'hint num' });

  const stepBtn = (
    icn: 'minus' | 'plus' | 'chevronsDown' | 'chevronsUp',
    delta: number,
    label: string,
  ) => {
    const b = iconButton(icn, label, () => nudge(delta));
    let t: ReturnType<typeof setTimeout> | null = null;
    let iv: ReturnType<typeof setInterval> | null = null;
    b.addEventListener('pointerdown', () => {
      t = setTimeout(() => (iv = setInterval(() => nudge(delta), 70)), 400);
    });
    const stop = () => {
      if (t) clearTimeout(t);
      if (iv) clearInterval(iv);
      t = iv = null;
    };
    b.addEventListener('pointerup', stop);
    b.addEventListener('pointerleave', stop);
    return b;
  };

  const layerBar = h(
    'div',
    { class: 'gc-layers' },
    stepBtn('chevronsDown', -10, '10 couches en dessous'),
    stepBtn('minus', -1, 'Couche précédente'),
    slider,
    stepBtn('plus', 1, 'Couche suivante'),
    stepBtn('chevronsUp', 10, '10 couches au-dessus'),
    h('div', { class: 'gc-layer-info' }, layerLabel, zLabel),
  );

  const timesCanvas = h('canvas', { class: 'chart', style: 'height:150px' });
  const timesInfo = h('div', { class: 'legend num' });

  host.append(
    h(
      'div',
      { class: 'grid gcode' },
      h(
        'div',
        { class: 'span-12' },
        panel(
          'G-code',
          h(
            'div',
            {},
            h(
              'div',
              { class: 'gc-bar' },
              title,
              h('span', { class: 'spacer' }),
              followBtn,
              singleBtn,
              iconButton('target', 'Recentrer la vue', resetCamera),
              button('Ouvrir…', { icon: 'files', cls: 'ghost', onClick: () => fileInput.click() }),
              fileInput,
            ),
            stageEl,
            layerBar,
          ),
          { flush: true },
        ),
      ),
      h(
        'div',
        { class: 'span-12' },
        panel('Durée des couches', h('div', {}, timesCanvas, timesInfo)),
      ),
    ),
  );

  /* ---- 3D ---- */

  function ensurePreview(colors: string | string[]): WebGLPreview {
    disposePreview();
    const p = new WebGLPreview({
      canvas,
      buildVolume: BUILD,
      backgroundColor: cssVar('--bg') || '#0a0a0b',
      extrusionColor: colors,
      topLayerColor: cssVar('--warn') || '#ffb020',
      lastSegmentColor: '#ffffff',
      lineWidth: 2,
      renderTravel: false,
      renderTubes: false,
      initialCameraPosition: CAMERA_HOME,
    });
    // La boucle 60 i/s de la bibliothèque redessine sans arrêt : rendu à la demande seulement.
    (p as unknown as { cancelAnimation(): void }).cancelAnimation();
    p.animate = () => undefined;
    p.controls.addEventListener('change', () => p.renderer.render(p.scene, p.camera));
    preview = p;
    nozzle = null;
    return p;
  }

  function disposePreview(): void {
    if (!preview) return;
    try {
      preview.dispose();
    } catch {
      /* contexte WebGL déjà perdu */
    }
    preview = null;
  }

  function redraw(): void {
    if (!preview) return;
    preview.renderer.render(preview.scene, preview.camera);
  }

  function resetCamera(): void {
    if (!preview) return;
    preview.camera.position.fromArray(CAMERA_HOME);
    preview.controls.target.set(BUILD.x / 2, 0, -BUILD.y / 2);
    preview.controls.update();
    redraw();
  }

  /** Les couches visibles passent par des plans de coupe : pas de reconstruction, un simple rendu. */
  function applyLayer(n: number): void {
    if (!preview) return;
    const total = preview.countLayers;
    layer = Math.max(1, Math.min(total, n));
    preview.singleLayerMode = single;
    preview.endLayer = layer;
    redraw();
    slider.max = String(total);
    slider.value = String(layer);
    setText(layerLabel, `Couche ${Math.max(0, layer - 1)} / ${Math.max(0, total - 1)}`);
    const z = (preview as unknown as { job: { layers: Array<{ z: number }> } }).job.layers[
      layer - 1
    ]?.z;
    setText(zLabel, z !== undefined ? `Z ${num(z, 1)} mm` : '');
  }

  function nudge(delta: number): void {
    if (!preview) return;
    setFollow(false);
    applyLayer(layer + delta);
  }

  function setFollow(on: boolean): void {
    follow = on;
    followBtn.classList.toggle('active', on);
    if (on) syncToPrint(true);
  }

  function setSingle(on: boolean): void {
    single = on;
    singleBtn.classList.toggle('active', on);
    applyLayer(layer);
  }

  slider.addEventListener('input', () => {
    setFollow(false);
    applyLayer(Number(slider.value));
  });

  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, select, textarea') && e.target !== slider) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') nudge(e.shiftKey ? 10 : 1);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') nudge(e.shiftKey ? -10 : -1);
    else return;
    e.preventDefault();
  };
  document.addEventListener('keydown', onKey);

  /* ---- chargement progressif ---- */

  async function loadStream(
    stream: ReadableStream<Uint8Array>,
    size: number,
    target: Loaded,
    colorMap: Array<{ t: number; color: string }>,
  ): Promise<void> {
    abort?.abort();
    const ctrl = new AbortController();
    abort = ctrl;
    const p = ensurePreview(extrusionColors(colorMap));
    loaded = target;
    setText(title, prettyFile(target.path));
    overlay.replaceChildren();
    loadBox.classList.remove('hidden');
    loadFill.style.width = '0%';

    const reader = stream
      .pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>)
      .getReader();
    ctrl.signal.addEventListener('abort', () => void reader.cancel().catch(() => undefined));
    let pending = '';
    let read = 0;
    let sinceRender = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        pending += value;
        read += value.length;
        sinceRender += value.length;
        if (pending.length < CHUNK_BYTES) continue;
        // Coupe sur une fin de ligne : une commande ne doit jamais être scindée.
        const cut = pending.lastIndexOf('\n') + 1;
        await p.processGCode(pending.slice(0, cut), { render: false });
        pending = pending.slice(cut);
        const pct = size ? Math.min(99, Math.round((read / size) * 100)) : 0;
        loadFill.style.width = `${pct}%`;
        setText(
          loadText,
          `${bytes(read)}${size ? ` / ${bytes(size)}` : ''} · ${p.countLayers} couches lues`,
        );
        if (sinceRender >= RENDER_EVERY_BYTES) {
          sinceRender = 0;
          p.render();
          applyLayer(p.countLayers);
        }
        await new Promise((r) => setTimeout(r, 0));
      }
      if (pending) await p.processGCode(pending, { render: false });
      if (ctrl.signal.aborted) return;
      loadBox.classList.add('hidden');
      p.render();
      applyLayer(p.countLayers);
      syncToPrint(true);
      resizeObserver.observe(canvas);
    } catch (err) {
      if (ctrl.signal.aborted) {
        setText(loadText, 'Chargement annulé');
        loadCancel.classList.add('hidden');
        return;
      }
      loadBox.classList.add('hidden');
      overlay.replaceChildren(
        h('div', { class: 'empty' }, `Lecture impossible : ${(err as Error).message}`),
      );
    }
  }

  async function loadRemote(
    path: string,
    source: Source,
    colorMap: Array<{ t: number; color: string }>,
    size = 0,
  ): Promise<void> {
    if (loaded?.path === path && preview) return;
    loadCancel.classList.remove('hidden');
    try {
      const res = await fetch(
        source === 'library'
          ? fileUrl(path)
          : `/api/files/download?source=${source}&file=${encodeURIComponent(path)}`,
      );
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const len = Number(res.headers.get('content-length')) || size;
      await loadStream(res.body, len, { path, source }, colorMap);
    } catch (err) {
      toast(`G-code indisponible : ${(err as Error).message}`, 'error');
      overlay.replaceChildren(h('div', { class: 'empty' }, 'Téléchargement du G-code impossible'));
    }
  }

  /* ---- suivi de l'impression ---- */

  function syncToPrint(force = false): void {
    const ps = store.printer.status?.print_status;
    const active = store.isActive;
    if (!preview || !loaded) return;
    const printing = active && ps?.filename && prettyFile(ps.filename) === prettyFile(loaded.path);
    if (!printing) {
      if (nozzle) nozzle.visible = false;
      return;
    }
    if (follow) {
      // Le parseur compte le préambule comme couche 0 : couche machine N = couche N+1.
      const target = (ps.current_layer ?? 0) + 1;
      if (force || target !== layer) applyLayer(target);
    }
    const gm = store.printer.status?.gcode_move;
    if (gm) {
      if (!nozzle) {
        const geo = new ConeGeometry(2.5, 7, 16);
        geo.rotateX(Math.PI);
        nozzle = new Mesh(
          geo,
          new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }),
        );
        preview.scene.add(nozzle);
      }
      nozzle.visible = true;
      nozzle.position.set(gm.x, gm.z + 3.5, -gm.y);
      redraw();
    }
  }

  function pickInitial(): void {
    const { file, source } = readParams();
    if (file) {
      const entry = (
        store.printer.files as Array<
          FileEntry & { color_map?: Array<{ t: number; color: string }> }
        >
      ).find((f) => f.filename === file || f.filename === file.split('/').pop());
      void loadRemote(file, source, entry?.color_map ?? [], entry?.size);
      return;
    }
    const ps = store.printer.status?.print_status;
    if (store.isActive && ps?.filename) {
      void loadRemote(ps.filename, 'local', store.printer.colorMap);
      return;
    }
    setText(title, 'Aucun fichier');
    overlay.replaceChildren(
      h(
        'div',
        { class: 'empty gc-empty' },
        ico('layers'),
        h(
          'p',
          {},
          "Aucune impression en cours. Choisir un fichier dans l'onglet Fichiers (bouton aperçu) ou en ouvrir un depuis cet appareil.",
        ),
      ),
    );
  }

  /* ---- durée des couches ---- */

  function drawTimes(): void {
    const data = store.printer.layerTimes;
    const rect = timesCanvas.getBoundingClientRect();
    if (rect.width < 10) return;
    const dpr = window.devicePixelRatio || 1;
    timesCanvas.width = Math.round(rect.width * dpr);
    timesCanvas.height = Math.round(rect.height * dpr);
    const ctx = timesCanvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    if (!data.length) {
      setText(timesInfo, "Les durées s'enregistrent pendant l'impression.");
      return;
    }
    const shown = data.slice(-Math.floor(rect.width / 3));
    const max = Math.max(...shown.map((d) => d.duration), 1);
    const avg = data.reduce((s, d) => s + d.duration, 0) / data.length;
    const w = rect.width / shown.length;
    const brand = cssVar('--brand');
    const warn = cssVar('--warn');
    shown.forEach((d, i) => {
      const bh = (d.duration / max) * (rect.height - 12);
      ctx.fillStyle = d.duration > avg * 1.8 ? warn : brand;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(i * w + 0.5, rect.height - bh, Math.max(1, w - 1), bh);
    });
    ctx.globalAlpha = 1;
    const ay = rect.height - (avg / max) * (rect.height - 12);
    ctx.strokeStyle = cssVar('--text-2');
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, ay);
    ctx.lineTo(rect.width, ay);
    ctx.stroke();
    const last = data[data.length - 1];
    setText(
      timesInfo,
      `Moyenne ${duration(avg)} · dernière couche ${last.layer} en ${duration(last.duration)} · ${data.length} couches mesurées`,
    );
  }

  const resizeObserver = new ResizeObserver(() => {
    preview?.resize();
    redraw();
  });
  const timesObserver = new ResizeObserver(drawTimes);
  timesObserver.observe(timesCanvas);

  const offStatus = store.on('status', () => syncToPrint());
  const offLayers = store.on('layers', drawTimes);
  const offFiles = store.on(['files', 'connection'], () => {
    if (!loaded && !abort) pickInitial();
  });

  setFollow(true);
  if (store.printer.status) pickInitial();
  drawTimes();

  return () => {
    abort?.abort();
    offStatus();
    offLayers();
    offFiles();
    resizeObserver.disconnect();
    timesObserver.disconnect();
    document.removeEventListener('keydown', onKey);
    disposePreview();
  };
}
