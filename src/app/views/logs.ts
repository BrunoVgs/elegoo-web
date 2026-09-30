import { eventText } from '../events';
import { clock, date } from '../format';
import { store } from '../store';
import { button, downloadBlob, h, panel, segmented, setPressed, setText } from '../ui/dom';

type EventFilter = 'all' | 'important';
type RawFilter = 'all' | 'sent' | 'received';

const RAW_SHOWN = 200;

export default function mount(host: HTMLElement): () => void {
  let evFilter: EventFilter = 'important';
  let rawFilter: RawFilter = 'all';
  let rawSearch = '';
  let paused = false;
  let hideStatus = true;

  const evList = h('div', { class: 'list log-events' });
  const evPicker = segmented(
    [
      { value: 'important', label: 'Importants' },
      { value: 'all', label: 'Tous' },
    ],
    evFilter,
    (v) => {
      evFilter = v as EventFilter;
      setPressed(evPicker, v);
      renderEvents();
    },
  );

  const rawList = h('div', { class: 'raw-list mono' });
  const rawCount = h('span', { class: 'hint num' });
  const dirPicker = segmented(
    [
      { value: 'all', label: 'Tout' },
      { value: 'sent', label: 'Envoyés' },
      { value: 'received', label: 'Reçus' },
    ],
    rawFilter,
    (v) => {
      rawFilter = v as RawFilter;
      setPressed(dirPicker, v);
      renderRaw();
    },
  );
  const search = h('input', {
    class: 'input grow',
    type: 'search',
    placeholder: 'Filtrer (méthode, champ…)',
  });
  search.addEventListener('input', () => {
    rawSearch = search.value.trim().toLowerCase();
    renderRaw();
  });
  const statusToggle = h('input', { type: 'checkbox' });
  statusToggle.checked = hideStatus;
  statusToggle.addEventListener('change', () => {
    hideStatus = statusToggle.checked;
    renderRaw();
  });
  const pauseBtn = button('Pause', {
    icon: 'pause',
    cls: 'ghost',
    onClick: () => {
      paused = !paused;
      pauseBtn.classList.toggle('active', paused);
      if (!paused) renderRaw();
    },
  });

  const service = h('dl', { class: 'kv' });

  host.append(
    h(
      'div',
      { class: 'grid logs' },
      h(
        'div',
        { class: 'span-5 stack' },
        panel('Événements', evList, { flush: true, actions: [evPicker] }),
        panel('Service', service),
      ),
      h(
        'div',
        { class: 'span-7 stack' },
        panel(
          'Trafic MQTT',
          h(
            'div',
            {},
            h(
              'div',
              { class: 'files-toolbar' },
              dirPicker,
              search,
              h('label', { class: 'row hint' }, statusToggle, 'masquer les statuts'),
              pauseBtn,
              button('Exporter', {
                icon: 'download',
                cls: 'ghost',
                onClick: () =>
                  downloadBlob(
                    new Blob([JSON.stringify(visibleRaw(), null, 2)], { type: 'application/json' }),
                    `mqtt-${Date.now()}.json`,
                  ),
              }),
            ),
            rawList,
            h(
              'div',
              { class: 'raw-foot' },
              rawCount,
              h(
                'span',
                { class: 'hint' },
                "Les messages contiennent le numéro de série et l'IP de l'imprimante.",
              ),
            ),
          ),
          { flush: true },
        ),
      ),
    ),
  );

  const renderEvents = () => {
    const rows = store.events
      .map((e) => ({ ts: e.ts, text: eventText(e.event) }))
      .filter((e) => e.text && (evFilter === 'all' || e.text.tone !== 'muted'))
      .reverse();
    evList.replaceChildren(
      ...(rows.length
        ? rows.map((e) =>
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
              h('span', { class: 'hint num' }, date(e.ts)),
            ),
          )
        : [h('div', { class: 'empty' }, 'Aucun événement')]),
    );
  };

  const visibleRaw = () =>
    store.raw.filter((r) => {
      if (rawFilter !== 'all' && r.dir !== rawFilter) return false;
      if (
        hideStatus &&
        (r.topic.endsWith('/api_status') || (r.data as { method?: number })?.method === 1002)
      )
        return false;
      if (
        rawSearch &&
        !JSON.stringify(r.data).toLowerCase().includes(rawSearch) &&
        !r.topic.includes(rawSearch)
      )
        return false;
      return true;
    });

  const renderRaw = () => {
    if (paused) return;
    const rows = visibleRaw().slice(-RAW_SHOWN).reverse();
    setText(rawCount, `${rows.length} affichés sur ${store.raw.length} en mémoire`);
    rawList.replaceChildren(
      ...rows.map((r) => {
        const d = r.data as { method?: number; id?: number };
        const body = h('pre', { class: 'raw-body hidden' }, JSON.stringify(r.data, null, 2));
        return h(
          'div',
          { class: `raw-row ${r.dir}`, onclick: () => body.classList.toggle('hidden') },
          h(
            'div',
            { class: 'raw-head' },
            h('span', { class: 'raw-dir' }, r.dir === 'sent' ? '→' : '←'),
            h('span', { class: 'num' }, clock(r.ts)),
            h('span', {}, d?.method ? String(d.method) : (r.topic.split('/').pop() ?? '')),
            h('span', { class: 'raw-preview' }, JSON.stringify(r.data).slice(0, 160)),
          ),
          body,
        );
      }),
    );
  };

  const renderService = () => {
    const s = store.service;
    const build = s.build as { describe?: string; version?: string } | undefined;
    const attrs = store.printer.attributes;
    const rows: Array<[string, string]> = [
      ['Imprimante', attrs?.machine_model ?? '--'],
      ['Firmware', attrs?.software_version?.ota_version ?? '--'],
      ['Numéro de série', String(s.printerSn ?? '--')],
      ['Adresse', String(s.printerIp ?? '--')],
      ['Lien MQTT', String(s.mqttPhase ?? '--')],
      ['Caméra', String(s.camera ?? '--')],
      ['Telegram', String(s.telegram ?? '--')],
      ['IA', String(s.ai ?? '--')],
      ['Navigateurs connectés', String(s.wsClients ?? '--')],
      ['Service', build?.describe ?? build?.version ?? '--'],
      [
        'Démarré depuis',
        typeof s.uptime === 'number'
          ? `${Math.floor(s.uptime / 3600)} h ${Math.floor((s.uptime % 3600) / 60)} min`
          : '--',
      ],
    ];
    service.replaceChildren(...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
  };

  const offEvents = store.on('events', renderEvents);
  const offRaw = store.on('raw', renderRaw);
  const offService = store.on(['service', 'status'], renderService);
  renderEvents();
  renderRaw();
  renderService();

  return () => {
    offEvents();
    offRaw();
    offService();
  };
}
