import { api, query, send } from '../commands';
import { bytes, date, duration, prettyFile } from '../format';
import { store } from '../store';
import { button, h, iconButton, panel, pill, stat } from '../ui/dom';
import { confirm, openModal } from '../ui/modal';

interface Report {
  id: string;
  filename: string;
  outcome: 'completed' | 'failed' | 'stopped';
  startedAt: number;
  endedAt: number;
  duration: number;
}

const OUTCOME: Record<string, [string, string]> = {
  completed: ['Terminée', 'ok'],
  failed: ['Échec', 'danger'],
  stopped: ['Arrêtée', 'warn'],
  printing: ['En cours', 'brand'],
  unknown: ['Inconnu', ''],
};

function playVideo(url: string, title: string): void {
  const video = h('video', {
    class: 'tl-video',
    controls: true,
    autoplay: true,
    playsinline: true,
    src: url,
  });
  openModal({
    title,
    body: video,
    wide: true,
    actions: [
      button('Télécharger', { icon: 'download', onClick: () => window.open(url, '_blank') }),
    ],
    onClose: () => video.pause(),
  });
}

export default function mount(host: HTMLElement): () => void {
  let reports: Report[] = [];

  const stats = h('div', { class: 'stats' });
  const historyList = h('div', { class: 'list' }, h('div', { class: 'empty' }, 'Chargement…'));
  const reportList = h('div', { class: 'list' }, h('div', { class: 'empty' }, 'Chargement…'));

  host.append(
    h(
      'div',
      { class: 'grid history' },
      h('div', { class: 'span-12' }, panel('Bilan', stats, { flush: true })),
      h(
        'div',
        { class: 'span-7 stack' },
        panel("Historique de l'imprimante", historyList, {
          flush: true,
          actions: [iconButton('refresh', 'Actualiser', () => query(1036, {}))],
        }),
      ),
      h(
        'div',
        { class: 'span-5 stack' },
        panel('Rapports détaillés', reportList, {
          flush: true,
          actions: [iconButton('refresh', 'Actualiser', () => void loadReports())],
        }),
      ),
    ),
  );

  const renderStats = () => {
    const items = store.printer.printHistory;
    const done = items.filter((i) => i.status === 'completed').length;
    const failed = items.filter((i) => i.status === 'failed' || i.status === 'stopped').length;
    const total = items.reduce(
      (s, i) => s + (i.end_time && i.begin_time ? i.end_time - i.begin_time : 0),
      0,
    );
    const since = Date.now() / 1000 - 30 * 86400;
    const month = items.filter((i) => i.begin_time > since);
    const monthTime = month.reduce(
      (s, i) => s + (i.end_time && i.begin_time ? i.end_time - i.begin_time : 0),
      0,
    );
    const rate = done + failed ? Math.round((done / (done + failed)) * 100) : 0;
    stats.replaceChildren(
      stat('Impressions', String(store.printer.printHistoryTotal || items.length)),
      stat('Réussite', done + failed ? `${rate} %` : '--'),
      stat('Temps machine', duration(total)),
      stat('30 derniers jours', `${month.length} · ${duration(monthTime)}`),
      stat('Timelapses', String(store.printer.timelapseList.length)),
    );
  };

  const renderHistory = () => {
    renderStats();
    const items = [...store.printer.printHistory].sort((a, b) => b.begin_time - a.begin_time);
    if (!items.length) {
      historyList.replaceChildren(h('div', { class: 'empty' }, 'Aucune impression enregistrée'));
      return;
    }
    historyList.replaceChildren(
      ...items.map((it) => {
        const [label, tone] = OUTCOME[it.status] ?? OUTCOME.unknown;
        const span = it.end_time && it.begin_time ? it.end_time - it.begin_time : 0;
        let tl: HTMLElement | null = null;
        if (it.timelapse_status === 2 && it.timelapse_url) {
          tl = button('Timelapse', {
            icon: 'film',
            cls: 'ghost',
            onClick: () => playVideo(it.timelapse_url, prettyFile(it.filename)),
          });
        } else if (it.timelapse_status === 1) {
          tl = button('Générer', {
            icon: 'film',
            cls: 'ghost',
            title: "Assembler la vidéo du timelapse sur l'imprimante",
            onClick: (e) =>
              void send(
                1051,
                { url: it.timelapse_url || it.filename },
                e.currentTarget as HTMLElement,
              ),
          });
        }
        return h(
          'div',
          { class: 'list-row' },
          h(
            'div',
            { class: 'list-main' },
            h('div', { class: 'list-title', title: it.filename }, prettyFile(it.filename)),
            h(
              'div',
              { class: 'list-sub' },
              pill(label, tone),
              h('span', {}, date(it.begin_time * 1000)),
              span ? h('span', {}, duration(span)) : null,
              it.timelapse_size ? h('span', {}, `vidéo ${bytes(it.timelapse_size)}`) : null,
            ),
          ),
          tl,
          iconButton('trash', "Retirer de l'historique", async () => {
            if (
              await confirm(
                "Retirer de l'historique",
                `${prettyFile(it.filename)} disparaîtra de l'historique de l'imprimante (et son timelapse).`,
                { ok: 'Retirer', tone: 'danger' },
              )
            )
              void send(1038, { list: [it.uuid] });
          }),
        );
      }),
    );
  };

  const renderReports = () => {
    if (!reports.length) {
      reportList.replaceChildren(h('div', { class: 'empty' }, 'Aucun rapport'));
      return;
    }
    reportList.replaceChildren(
      ...reports.map((r) => {
        const [label, tone] = OUTCOME[r.outcome] ?? OUTCOME.unknown;
        return h(
          'div',
          { class: 'list-row' },
          h(
            'div',
            { class: 'list-main' },
            h('div', { class: 'list-title', title: r.filename }, prettyFile(r.filename)),
            h(
              'div',
              { class: 'list-sub' },
              pill(label, tone),
              h('span', {}, date(r.startedAt)),
              h('span', {}, duration(r.duration)),
            ),
          ),
          iconButton('report', 'Rapport PDF', () =>
            window.open(`/api/reports/${encodeURIComponent(r.id)}/pdf`, '_blank'),
          ),
          iconButton('trash', 'Supprimer le rapport', async () => {
            if (
              !(await confirm('Supprimer le rapport', prettyFile(r.filename), {
                ok: 'Supprimer',
                tone: 'danger',
              }))
            )
              return;
            await api(`/api/reports/${encodeURIComponent(r.id)}`, { method: 'DELETE' }).catch(
              () => undefined,
            );
            void loadReports();
          }),
        );
      }),
    );
  };

  const loadReports = async () => {
    try {
      const res = await api<{ reports: Report[] }>('/api/reports');
      reports = res.reports ?? [];
    } catch {
      reports = [];
    }
    renderReports();
  };

  const off = store.on('history', renderHistory);
  renderHistory();
  query(1036, {});
  void loadReports();
  return off;
}
