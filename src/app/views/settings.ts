import { api, postJson } from '../commands';
import { beep, notifyPrefs, saveNotifyPrefs } from '../notify';
import { store } from '../store';
import { button, h, panel, pill, switchInput } from '../ui/dom';
import { stepper } from '../ui/stepper';
import { toast } from '../ui/toast';

interface AILabel {
  label: string;
  severity: 'ok' | 'warning' | 'critical';
  warnThreshold: number;
  critThreshold: number;
  group?: string;
}

const SEVERITY: Array<[AILabel['severity'], string]> = [
  ['ok', 'Normal'],
  ['warning', 'Avertissement'],
  ['critical', 'Critique'],
];

export default function mount(host: HTMLElement): () => void {
  /* ---- notifications du navigateur ---- */

  const prefs = notifyPrefs();
  const permission = h('span', { class: 'hint' });
  const syncPermission = () => {
    const p = 'Notification' in window ? Notification.permission : 'unsupported';
    permission.textContent =
      p === 'granted'
        ? 'autorisées'
        : p === 'denied'
          ? 'bloquées dans le navigateur'
          : p === 'unsupported'
            ? 'non prises en charge'
            : 'à autoriser';
  };
  syncPermission();
  const notifBody = h(
    'div',
    { class: 'stack' },
    h(
      'label',
      { class: 'row between' },
      h('span', {}, "Son à la fin et en cas d'erreur"),
      switchInput(prefs.sound, (on) => {
        prefs.sound = on;
        saveNotifyPrefs(prefs);
        if (on) beep('ok');
      }),
    ),
    h(
      'label',
      { class: 'row between' },
      h('span', {}, 'Notifications système (onglet en arrière-plan) ', permission),
      switchInput(prefs.desktop, async (on) => {
        if (on && 'Notification' in window && Notification.permission === 'default')
          await Notification.requestPermission();
        prefs.desktop = on;
        saveNotifyPrefs(prefs);
        syncPermission();
      }),
    ),
  );

  /* ---- Telegram ---- */

  const tgState = h('div', { class: 'row wrap' });
  const tgInterval = stepper({
    value: 25,
    min: 5,
    max: 50,
    step: 5,
    unit: '%',
    onCommit: async (v) => {
      try {
        await postJson('/api/config/telegram', { progressInterval: v });
        toast(`Progression envoyée tous les ${v} %`, 'ok');
      } catch (err) {
        toast(`Telegram : ${(err as Error).message}`, 'error');
      }
    },
  });
  const tgBody = h(
    'div',
    { class: 'stack' },
    tgState,
    h(
      'div',
      { class: 'row between' },
      h('span', {}, 'Message de progression tous les'),
      tgInterval.el,
    ),
    h(
      'p',
      { class: 'hint', style: 'margin:0' },
      'Le bot envoie le début, la fin, les échecs, les erreurs et les alertes IA avec une photo. Commandes : /status, /photo, /pause, /resume.',
    ),
  );

  const loadTelegram = async () => {
    try {
      const cfg = await api<{ enabled: boolean; chatId: string; progressInterval: number }>(
        '/api/config/telegram',
      );
      const running = store.service.telegram === 'running';
      tgState.replaceChildren(
        pill(
          cfg.enabled ? (running ? 'Connecté' : 'Configuré, bot arrêté') : 'Non configuré',
          cfg.enabled ? (running ? 'ok' : 'warn') : '',
        ),
        cfg.chatId
          ? h('span', { class: 'hint mono' }, `chat ${cfg.chatId}`)
          : h(
              'span',
              { class: 'hint' },
              'TELEGRAM_BOT_TOKEN et TELEGRAM_CHAT_ID à renseigner côté service',
            ),
      );
      tgInterval.sync(cfg.progressInterval);
    } catch {
      tgState.replaceChildren(pill('Indisponible', 'danger'));
    }
  };

  /* ---- IA : seuils des étiquettes ---- */

  let labels: AILabel[] = [];
  const aiList = h('div', { class: 'ai-labels' });
  const renderLabels = () => {
    aiList.replaceChildren(
      ...labels.map((l, i) => {
        const sev = h('select', { class: 'select' });
        for (const [v, t] of SEVERITY) sev.append(h('option', { value: v }, t));
        sev.value = l.severity;
        sev.addEventListener(
          'change',
          () => (labels[i].severity = sev.value as AILabel['severity']),
        );
        const warn = stepper({
          value: Math.round(l.warnThreshold * 100),
          min: 0,
          max: 100,
          step: 5,
          settleMs: 0,
          onCommit: (v) => (labels[i].warnThreshold = v / 100),
        });
        const crit = stepper({
          value: Math.round(l.critThreshold * 100),
          min: 0,
          max: 100,
          step: 5,
          settleMs: 0,
          onCommit: (v) => (labels[i].critThreshold = v / 100),
        });
        const short = l.label.split(',').slice(-1)[0].trim();
        return h(
          'div',
          { class: 'ai-label-row' },
          h(
            'div',
            { class: 'list-main' },
            h('div', { class: 'list-title', title: l.label }, short),
            h('div', { class: 'list-sub' }, l.group ?? ''),
          ),
          sev,
          h('div', { class: 'ai-th' }, h('span', { class: 'hint' }, 'alerte %'), warn.el),
          h('div', { class: 'ai-th' }, h('span', { class: 'hint' }, 'critique %'), crit.el),
        );
      }),
    );
  };
  const loadLabels = async () => {
    try {
      const res = await api<{ labels: AILabel[]; enabled: boolean }>('/api/config/ai-labels');
      labels = res.labels ?? [];
      if (!res.enabled) {
        aiList.replaceChildren(
          h('p', { class: 'muted', style: 'margin:0' }, 'Analyse locale désactivée côté service.'),
        );
        return;
      }
      renderLabels();
    } catch {
      aiList.replaceChildren(
        h('p', { class: 'muted', style: 'margin:0' }, 'Configuration IA indisponible.'),
      );
    }
  };
  const aiActions = [
    button("Valeurs d'origine", {
      cls: 'ghost',
      onClick: async () => {
        await api('/api/config/ai-labels', { method: 'DELETE' }).catch(() => undefined);
        void loadLabels();
        toast('Seuils IA réinitialisés', 'ok');
      },
    }),
    button('Enregistrer', {
      cls: 'primary',
      onClick: async () => {
        try {
          await postJson('/api/config/ai-labels', { labels });
          toast('Seuils IA enregistrés', 'ok');
        } catch (err) {
          toast(`IA : ${(err as Error).message}`, 'error');
        }
      },
    }),
  ];

  host.append(
    h(
      'div',
      { class: 'grid settings' },
      h(
        'div',
        { class: 'span-5 stack' },
        panel('Notifications de cette page', notifBody),
        panel('Telegram', tgBody),
      ),
      h(
        'div',
        { class: 'span-7 stack' },
        panel(
          'Détection IA',
          h(
            'div',
            { class: 'stack' },
            h(
              'p',
              { class: 'hint', style: 'margin:0' },
              "Chaque image est comparée à ces descriptions. Une étiquette dont le score dépasse le seuil compte comme une détection ; l'alerte part après plusieurs détections consécutives.",
            ),
            aiList,
          ),
          { actions: aiActions },
        ),
      ),
    ),
  );

  let tgStatus = store.service.telegram;
  const off = store.on('service', () => {
    if (store.service.telegram === tgStatus) return;
    tgStatus = store.service.telegram;
    void loadTelegram();
  });
  void loadTelegram();
  void loadLabels();
  return off;
}
