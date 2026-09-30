import { duration, prettyFile } from './format';
import { exceptionLabel } from './labels';
import { toast } from './ui/toast';

const PREF_KEY = 'cc2-notify';

export interface NotifyPrefs {
  desktop: boolean;
  sound: boolean;
}

export function notifyPrefs(): NotifyPrefs {
  try {
    return { desktop: false, sound: true, ...JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') };
  } catch {
    return { desktop: false, sound: true };
  }
}

export function saveNotifyPrefs(p: NotifyPrefs): void {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {
    /* préférence non mémorisée */
  }
}

let audio: AudioContext | null = null;

/** Deux bips courts, plus graves pour une erreur. */
export function beep(kind: 'ok' | 'error'): void {
  try {
    audio ??= new AudioContext();
    const ctx = audio;
    const freqs = kind === 'ok' ? [880, 1320] : [440, 330];
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = f;
      osc.type = 'sine';
      const t = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.17);
    });
  } catch {
    /* audio bloqué tant que la page n'a pas reçu d'interaction */
  }
}

function describe(
  event: Record<string, unknown>,
): { title: string; body: string; kind: 'ok' | 'error' } | null {
  const file = typeof event.filename === 'string' ? prettyFile(event.filename) : '';
  switch (event.type) {
    case 'print_completed':
      return {
        title: 'Impression terminée',
        body: `${file} en ${duration(Number(event.duration))}`,
        kind: 'ok',
      };
    case 'print_failed':
      return {
        title: 'Impression interrompue',
        body: `${file} : ${String(event.reason ?? '')}`,
        kind: 'error',
      };
    case 'filament_runout':
      return { title: 'Fin de filament', body: "L'impression attend une bobine.", kind: 'error' };
    case 'error': {
      const codes = Array.isArray(event.codes) ? (event.codes as number[]) : [];
      return {
        title: 'Erreur imprimante',
        body: codes.map(exceptionLabel).join(', '),
        kind: 'error',
      };
    }
    case 'first_layer_complete':
      return {
        title: 'Première couche terminée',
        body: `${file} : vérifier l'adhérence`,
        kind: 'ok',
      };
    default:
      return null;
  }
}

/** Événement reçu en direct (jamais à la reconnexion) : toast, son, notification système. */
export function notifyEvent(event: Record<string, unknown>): void {
  const d = describe(event);
  if (!d) return;
  const prefs = notifyPrefs();
  toast(`${d.title} : ${d.body}`, d.kind === 'ok' ? 'ok' : 'error', 8000);
  if (prefs.sound) beep(d.kind);
  if (
    prefs.desktop &&
    'Notification' in window &&
    Notification.permission === 'granted' &&
    document.hidden
  ) {
    new Notification(d.title, {
      body: d.body,
      icon: '/icons/icon-192.svg',
      tag: String(event.type),
    });
  }
}
