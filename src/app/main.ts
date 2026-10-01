import './styles/index.css';
import type { CanvasInfo, FileEntry, PrinterAttributes, PrinterStatus } from '../types';
import { WsClient } from '../ws-client';
import { bindClient, query, send, settle } from './commands';
import { exceptionLabel } from './labels';
import { notifyEvent } from './notify';
import { ROUTES, currentRoute } from './router';
import { type EventEntry, store } from './store';
import { $, button, h, ico, setText } from './ui/dom';
import { confirm } from './ui/modal';
import { toast } from './ui/toast';

/* ---- séries des graphes (libellés et couleurs portés par chaque graphe) ---- */

const SERIES = [
  'nozzle',
  'nozzle_tgt',
  'bed',
  'bed_tgt',
  'chamber',
  'fan_model',
  'fan_aux',
  'fan_case',
  'ai_motion',
  'ai_printing',
  'ai_failure',
  'ai_empty',
];
for (const key of SERIES) store.charts.defineSeries(key, key, '');

function aiPoint(motion: number, scores: Record<string, number>): Record<string, number> {
  return {
    ai_motion: motion,
    ai_printing: scores['Print in Progress'] ?? 0,
    ai_failure: scores['Spaghetti/Failure'] ?? 0,
    ai_empty: scores['Empty Bed'] ?? 0,
  };
}

/* ---- navigation ---- */

const nav = $('nav');
const viewHost = $('view');
let unmount: (() => void) | null = null;
let routeToken = 0;

for (const r of ROUTES) {
  nav.append(
    h(
      'a',
      { class: 'rail-item', href: `#/${r.id}`, 'data-route': r.id },
      ico(r.icon),
      h('span', { class: 'rail-label' }, r.label),
    ),
  );
}

async function renderRoute(): Promise<void> {
  const route = currentRoute();
  const token = ++routeToken;
  for (const a of nav.querySelectorAll<HTMLElement>('.rail-item')) {
    if (a.dataset.route === route.id) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  document.title = `${route.label} - Imprimante 3D`;
  unmount?.();
  unmount = null;
  viewHost.replaceChildren(h('div', { class: 'view-loading skeleton' }));
  const mod = await route.load();
  if (token !== routeToken) return;
  viewHost.replaceChildren();
  viewHost.dataset.view = route.id;
  unmount = mod.default(viewHost);
  $('view').parentElement?.scrollTo({ top: 0 });
}

window.addEventListener('hashchange', () => void renderRoute());

/* ---- barre du haut ---- */

const topState = $('topbar-state');
const dot = $('conn-dot');

function renderTopbar(): void {
  dot.dataset.state =
    store.connection === 'connected' && !store.printerLinked ? 'error' : store.connection;
  const phase = store.phase;
  const tone =
    phase === 'printing'
      ? 'brand live'
      : phase === 'paused'
        ? 'warn'
        : phase === 'estop' || phase === 'offline'
          ? 'danger'
          : phase === 'busy'
            ? 'info live'
            : 'ok';
  const pieces: Node[] = [h('span', { class: `pill ${tone}` }, store.phaseLabel)];
  if (store.isActive) {
    const bar = h(
      'div',
      { class: 'topbar-progress' },
      h('span', { style: `width:${store.progress}%` }),
    );
    pieces.push(h('span', { class: 'num' }, `${store.progress}%`), bar);
  }
  const name = store.printer.attributes?.hostname;
  if (name) setText($('printer-name'), name);
  const sig = `${tone}|${store.phaseLabel}|${store.isActive ? store.progress : ''}`;
  if (topState.dataset.sig !== sig) {
    topState.dataset.sig = sig;
    topState.replaceChildren(...pieces);
  }
}

/* ---- bandeaux : erreurs machine, lien MQTT ---- */

const banners = $('banners');

function renderBanners(): void {
  const items: HTMLElement[] = [];
  const exceptions = store.printer.status?.machine_status?.exception_status ?? [];
  for (const code of exceptions) {
    items.push(
      h(
        'div',
        { class: 'banner danger' },
        ico('octagon'),
        h('span', { class: 'banner-text' }, exceptionLabel(code)),
        h('span', { class: 'mono' }, String(code)),
      ),
    );
  }
  const phase = String(store.service.mqttPhase ?? '');
  if (
    store.connection === 'connected' &&
    phase &&
    phase !== 'connected' &&
    phase !== 'disconnected'
  ) {
    const msg =
      phase === 'rejected'
        ? "L'imprimante refuse la connexion : deux clients sont déjà connectés."
        : phase === 'awaiting_sn'
          ? "Le broker répond mais l'imprimante reste muette : son application a peut-être planté."
          : "Connexion MQTT à l'imprimante en cours.";
    items.push(
      h('div', { class: 'banner warn' }, ico('alert'), h('span', { class: 'banner-text' }, msg)),
    );
  }
  if (store.phase === 'powerloss') {
    items.push(
      h(
        'div',
        { class: 'banner warn' },
        ico('alert'),
        h('span', { class: 'banner-text' }, 'Impression interrompue par une coupure de courant.'),
        button('Reprendre', {
          cls: 'ok',
          onClick: async (e) => {
            if (
              await confirm(
                'Reprendre après coupure',
                "L'impression repart de la dernière couche enregistrée.",
                { ok: 'Reprendre' },
              )
            )
              void send(1023, {}, e.currentTarget as HTMLElement);
          },
        }),
        button('Abandonner', {
          cls: 'danger',
          onClick: async (e) => {
            if (
              await confirm('Abandonner la reprise', "L'impression interrompue sera perdue.", {
                ok: 'Abandonner',
                tone: 'danger',
              })
            )
              void send(1022, {}, e.currentTarget as HTMLElement);
          },
        }),
      ),
    );
  }
  const sig = items.map((i) => i.textContent).join('|');
  if (banners.dataset.sig !== sig) {
    banners.dataset.sig = sig;
    banners.replaceChildren(...items);
  }
}

store.on(['status', 'connection', 'service'], () => {
  renderTopbar();
  renderBanners();
});

/* ---- actions globales ---- */

const THEMES = ['dark', 'light', 'auto'] as const;
function applyTheme(choice: (typeof THEMES)[number]): void {
  const light =
    choice === 'light' ||
    (choice === 'auto' && matchMedia('(prefers-color-scheme: light)').matches);
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  $('btn-theme').replaceChildren(ico(light ? 'sun' : 'moon'));
  $('btn-theme').title =
    `Thème : ${choice === 'auto' ? 'système' : choice === 'light' ? 'clair' : 'sombre'}`;
}
function storedTheme(): (typeof THEMES)[number] {
  try {
    const v = localStorage.getItem('cc2-theme');
    return (THEMES as readonly string[]).includes(v ?? '')
      ? (v as (typeof THEMES)[number])
      : 'dark';
  } catch {
    return 'dark';
  }
}
applyTheme(storedTheme());
$('btn-theme').addEventListener('click', () => {
  const next = THEMES[(THEMES.indexOf(storedTheme()) + 1) % THEMES.length];
  try {
    localStorage.setItem('cc2-theme', next);
  } catch {
    /* thème non mémorisé, appliqué pour la session */
  }
  applyTheme(next);
});

$('btn-estop').append(ico('octagon'));
$('btn-estop').addEventListener('click', async () => {
  const ok = await confirm(
    "Arrêt d'urgence",
    "Coupe immédiatement moteurs et chauffes. L'impression en cours est perdue et l'imprimante devra être remise à l'origine.",
    { ok: 'Arrêter tout', tone: 'danger' },
  );
  if (ok) void send(1007, {});
});

/* ---- WebSocket ---- */

function hydrate(init: Record<string, unknown>): void {
  const p = store.printer;
  if (init.status) p.setFullStatus(init.status as PrinterStatus);
  if (init.attributes) p.setAttributes(init.attributes as PrinterAttributes);
  if (init.canvas) p.setCanvas(init.canvas as CanvasInfo);
  if (Array.isArray(init.files)) p.setFiles(init.files as FileEntry[]);
  if (typeof init.thumbnail === 'string') p.thumbnail = init.thumbnail;
  if (typeof init.fileTotalLayers === 'number') p.fileTotalLayers = init.fileTotalLayers;
  if (Array.isArray(init.layerTimes)) {
    const lt = init.layerTimes as Array<{ layer: number; duration: number; timestamp: number }>;
    if (lt.length) p.restoreLayerData(lt, 0, 0);
  }
  if (Array.isArray(init.filamentUsage))
    p.filamentUsage = init.filamentUsage as typeof p.filamentUsage;
  if (init.serviceStatus) applyService(init.serviceStatus as Record<string, unknown>);
  if (Array.isArray(init.chartHistory)) {
    store.charts.loadHistory(
      init.chartHistory as Array<{ t: number; values: Record<string, number> }>,
    );
  }
  if (Array.isArray(init.aiChartHistory)) {
    for (const pt of init.aiChartHistory as Array<{
      t: number;
      motion: number;
      scores: Record<string, number>;
    }>)
      store.charts.pushPoint(pt.t, aiPoint(pt.motion, pt.scores));
  }
  if (Array.isArray(init.eventLog)) {
    store.events = (init.eventLog as EventEntry[]).slice(-300);
    store.emit('events');
  }
  for (const t of ['status', 'files', 'layers', 'thumb', 'history'] as const) store.emit(t);
}

function applyService(data: Record<string, unknown>): void {
  store.service = { ...store.service, ...data };
  if (typeof data.ai === 'string') {
    store.ai.status = data.ai;
    store.ai.config = (data.aiConfig as Record<string, unknown> | null) ?? null;
    store.emit('ai');
  }
  store.emit('service');
}

function onResponse(method: number): void {
  if (method === 1044 || method === 1048) store.emit('files');
  else if (method === 1045 || method === 1046) store.emit('thumb');
  else if (method === 1036 || method === 1050 || method === 1051) store.emit('history');
  else if (method === 1047) {
    store.emit('files');
  } else if (method === 1038) {
    query(1036, {});
  } else if (method === 2003 || method === 2001 || method === 2002 || method === 2004) {
    setTimeout(() => query(2005, {}), 800);
  }
  if (method === 1026 || method === 1027) query(1002, {});
  store.emit('status');
}

const client = new WsClient({
  serviceUrl: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`,
  onStateChange(conn) {
    const was = store.connection;
    store.connection = conn;
    if (conn !== 'connected') store.printerLinked = false;
    if (was === 'connected' && conn === 'disconnected')
      toast('Connexion au service perdue, reconnexion…', 'warn');
    store.emit('connection');
  },
  onRegistered() {
    const first = !store.printerLinked;
    store.printerLinked = true;
    store.emit('connection');
    if (first) {
      query(1048, { storage_media: 'local' });
      query(2006, {});
      query(1036, {});
    }
  },
  onPrinterLost() {
    store.printerLinked = false;
    store.emit('connection');
  },
  onInit: hydrate,
  onMessage(method, data) {
    store.printer.handleResponse(method, data as Record<string, unknown>);
    settle(method, data);
    onResponse(method);
  },
  onStatusEvent(data) {
    store.printer.handleStatusEvent(data as Record<string, unknown>);
    store.emit('status');
    const sub = (data as { result?: { machine_status?: { sub_status?: number } } }).result
      ?.machine_status?.sub_status;
    if (sub === 3021) {
      toast('Timelapse prêt', 'ok');
      query(1036, {});
    } else if (sub === 3022) toast('Export du timelapse en échec', 'error');
  },
  onServiceStatus: applyService,
  onRawMessage(dir, topic, data) {
    store.pushRaw({ ts: Date.now(), dir, topic, data });
  },
  onChartData(t, values) {
    store.charts.pushPoint(t, values);
  },
  onAIAnalysis(data) {
    store.ai.last = data;
    store.emit('ai');
  },
  onAIAlert(data) {
    store.ai.alerts.unshift(data);
    store.ai.alerts.splice(20);
    store.emit('ai');
    toast(
      `IA : ${String(data.description ?? 'anomalie détectée')}`,
      data.status === 'critical' ? 'error' : 'warn',
      9000,
    );
  },
  onAIChartData(t, motion, scores) {
    store.charts.pushPoint(t, aiPoint(motion, scores));
  },
  onEventLog(entry) {
    store.pushEvent(entry);
    notifyEvent(entry.event);
  },
  onLayerTime(entry) {
    store.printer.addLayerTime(entry);
    store.emit('layers');
  },
  onLayerClear() {
    store.printer.clearLayerTimes();
    store.emit('layers');
  },
  onFilamentUsage(usage) {
    store.printer.filamentUsage = usage;
    store.emit('status');
  },
  onPrintQueue(queue) {
    store.queue = queue as typeof store.queue;
    store.emit('queue');
  },
});

bindClient(client);
store.printer.setRefreshCallback(() => query(1002, {}));
client.connect();
void renderRoute();
renderTopbar();

window.addEventListener('error', (e) => {
  navigator.sendBeacon?.(
    '/api/client-error',
    JSON.stringify({
      message: e.message,
      stack: e.error?.stack,
      url: e.filename,
      line: e.lineno,
      col: e.colno,
    }),
  );
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
