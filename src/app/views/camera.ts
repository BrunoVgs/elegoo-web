import { ago, clock } from '../format';
import { ISSUE_FR } from '../labels';
import { go } from '../router';
import { store } from '../store';
import { cameraView } from '../ui/camera';
import { liveChart } from '../ui/chart';
import { button, h, panel, pill } from '../ui/dom';

const AI_STATE: Record<string, [string, string]> = {
  monitoring: ['Surveillance active', 'ok live'],
  idle: ["En attente d'une impression", 'info'],
  stopped: ['Arrêtée', 'warn'],
  disabled: ['Désactivée', ''],
};

const VERDICT: Record<string, [string, string]> = {
  ok: ['RAS', 'ok'],
  warning: ['À surveiller', 'warn'],
  critical: ['Anomalie', 'danger'],
};

export default function mount(host: HTMLElement): () => void {
  const cam = cameraView();

  const aiState = h('div', { class: 'row wrap' });
  const aiConfig = h('dl', { class: 'kv' });
  const verdict = h('div', { class: 'ai-verdict' });
  const scores = h('div', { class: 'ai-scores' });
  const alerts = h('div', { class: 'list' });

  const motion = liveChart({
    store: store.charts,
    windowSec: 1800,
    unit: '%',
    yMin: 0,
    height: 120,
    series: [{ key: 'ai_motion', label: 'Mouvement', color: '--info' }],
  });
  const classes = liveChart({
    store: store.charts,
    windowSec: 1800,
    unit: '',
    yMin: 0,
    yMax: 100,
    height: 140,
    series: [
      { key: 'ai_printing', label: 'Impression normale', color: '--ok' },
      { key: 'ai_failure', label: 'Échec', color: '--danger' },
      { key: 'ai_empty', label: 'Plateau vide', color: '--muted' },
    ],
  });

  host.append(
    h(
      'div',
      { class: 'grid camera-view' },
      h(
        'div',
        { class: 'span-8 stack' },
        h('section', { class: 'panel cam-panel' }, cam.el),
        panel('Analyse image', h('div', {}, motion.el, classes.el)),
      ),
      h(
        'div',
        { class: 'span-4 stack' },
        panel('Surveillance IA', h('div', { class: 'stack' }, aiState, verdict, scores, aiConfig)),
        panel('Alertes', alerts, { flush: true }),
        panel(
          'Timelapses',
          h(
            'div',
            { class: 'row between' },
            h('span', { class: 'muted' }, 'Vidéos générées à la fin des impressions'),
            button('Ouvrir', { cls: 'ghost', onClick: () => go('historique') }),
          ),
        ),
      ),
    ),
  );

  const render = () => {
    const [label, tone] = AI_STATE[store.ai.status] ?? [store.ai.status, ''];
    const cfg = store.ai.config;
    const parts: Node[] = [pill(label, tone)];
    if (cfg && cfg.localEnabled && !cfg.localReady)
      parts.push(pill('Modèle en chargement', 'info live'));
    aiState.replaceChildren(...parts);

    if (store.ai.status === 'disabled') {
      verdict.replaceChildren(
        h(
          'p',
          { class: 'muted', style: 'margin:0' },
          'La surveillance IA est coupée côté service (AI_ENABLED).',
        ),
      );
      scores.replaceChildren();
      aiConfig.replaceChildren();
    } else {
      const last = store.ai.last;
      if (last) {
        const [vText, vTone] = VERDICT[String(last.status)] ?? [String(last.status), ''];
        const issues =
          (last.issues as Array<{ type: string; confidence: number }> | undefined) ?? [];
        verdict.replaceChildren(
          h(
            'div',
            { class: 'row between' },
            pill(vText, vTone),
            h(
              'span',
              { class: 'hint num' },
              `${clock(Number(last.timestamp))} · ${Math.round(Number(last.durationMs ?? 0))} ms`,
            ),
          ),
          ...(issues.length
            ? [
                h(
                  'div',
                  { class: 'list-sub' },
                  ...issues.map((i) =>
                    h(
                      'span',
                      {},
                      `${ISSUE_FR[i.type] ?? i.type} ${Math.round(i.confidence * 100)} %`,
                    ),
                  ),
                ),
              ]
            : []),
        );
        const labelScores = (
          (last.labelScores as Array<{ label: string; score: number }> | undefined) ?? []
        )
          .slice()
          .sort((a, b) => b.score - a.score)
          .slice(0, 5);
        scores.replaceChildren(
          ...labelScores.map((s) =>
            h(
              'div',
              { class: 'ai-score' },
              h(
                'div',
                { class: 'row between' },
                h(
                  'span',
                  { class: 'ai-label', title: s.label },
                  s.label.split(',').slice(-1)[0].trim(),
                ),
                h('b', { class: 'num' }, `${Math.round(s.score * 100)} %`),
              ),
              h(
                'div',
                { class: 'bar thin' },
                h('span', { style: `width:${Math.round(s.score * 100)}%` }),
              ),
            ),
          ),
        );
      } else {
        verdict.replaceChildren(
          h(
            'p',
            { class: 'muted', style: 'margin:0' },
            "Pas encore d'analyse : elles démarrent avec une impression.",
          ),
        );
        scores.replaceChildren();
      }
      if (cfg) {
        const rows: Array<[string, string]> = [
          ['Analyse locale', cfg.localEnabled ? String(cfg.localModel).split('/').pop()! : 'non'],
          ['Modèle distant', cfg.vlmEnabled ? String(cfg.vlmModel) : 'non'],
          ['Intervalle', `${cfg.intervalSec} s`],
          ['Alerte après', `${cfg.alertThreshold} détections`],
          ['Analyses', String(cfg.analysisCount ?? 0)],
        ];
        aiConfig.replaceChildren(...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
      }
    }

    alerts.replaceChildren(
      ...(store.ai.alerts.length
        ? store.ai.alerts.map((a) =>
            h(
              'div',
              { class: 'list-row' },
              h('span', { class: `ev-dot ${a.status === 'critical' ? 'danger' : 'warn'}` }),
              h(
                'div',
                { class: 'list-main' },
                h('div', { class: 'list-title' }, String(a.description ?? 'Anomalie')),
                h(
                  'div',
                  { class: 'list-sub' },
                  `${a.consecutiveWarnings ?? '?'} détections consécutives`,
                ),
              ),
              h('span', { class: 'hint num' }, ago(Number(a.timestamp))),
            ),
          )
        : [h('div', { class: 'empty' }, 'Aucune alerte depuis le chargement de la page')]),
    );
  };

  const off = store.on(['ai', 'service'], render);
  render();

  return () => {
    off();
    cam.destroy();
    motion.destroy();
    classes.destroy();
  };
}
