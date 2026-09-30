import { duration, prettyFile } from './format';
import { exceptionLabel, statusLabel, subStatusLabel } from './labels';

export interface EventText {
  title: string;
  detail: string;
  tone: 'ok' | 'warn' | 'danger' | 'info' | 'muted';
}

/** Événement du service rendu lisible ; `null` pour ceux qui ne méritent pas d'affichage. */
export function eventText(ev: Record<string, unknown>): EventText | null {
  const file = typeof ev.filename === 'string' ? prettyFile(ev.filename) : '';
  switch (ev.type) {
    case 'connected':
      return { title: 'Imprimante connectée', detail: '', tone: 'ok' };
    case 'disconnected':
      return { title: 'Imprimante déconnectée', detail: '', tone: 'danger' };
    case 'print_started':
      return {
        title: ev.resumed ? 'Impression reprise' : 'Impression lancée',
        detail: file,
        tone: 'info',
      };
    case 'print_completed':
      return {
        title: 'Impression terminée',
        detail: `${file} · ${duration(Number(ev.duration))}`,
        tone: 'ok',
      };
    case 'print_failed':
      return {
        title: 'Impression interrompue',
        detail: `${file} · ${String(ev.reason ?? '')}`,
        tone: 'danger',
      };
    case 'first_layer_complete':
      return {
        title: 'Première couche terminée',
        detail: `${duration(Number(ev.durationSec))}`,
        tone: 'ok',
      };
    case 'filament_runout':
      return { title: 'Fin de filament', detail: '', tone: 'danger' };
    case 'error': {
      const codes = Array.isArray(ev.codes) ? (ev.codes as number[]) : [];
      return {
        title: 'Erreur imprimante',
        detail: codes.map(exceptionLabel).join(', '),
        tone: 'danger',
      };
    }
    case 'status_change':
      return {
        title: statusLabel(Number(ev.toCode)),
        detail: `après ${statusLabel(Number(ev.fromCode)).toLowerCase()}`,
        tone: 'muted',
      };
    case 'sub_status_change': {
      const to = subStatusLabel(Number(ev.toCode));
      return to ? { title: to, detail: '', tone: 'muted' } : null;
    }
    default:
      return null;
  }
}
