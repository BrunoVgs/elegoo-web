import { classifyCommandOutcome, describeCommandError } from '../types';
import type { WsClient } from '../ws-client';
import { toast } from './ui/toast';

/** Libellés des écritures dont l'issue mérite un toast. */
const WRITE_LABELS: Record<number, string> = {
  1007: "Arrêt d'urgence",
  1020: 'Lancement',
  1021: 'Pause',
  1022: 'Arrêt',
  1023: 'Reprise',
  1026: 'Origine',
  1027: 'Déplacement',
  1028: 'Température',
  1029: 'Éclairage',
  1030: 'Ventilation',
  1031: 'Mode vitesse',
  1032: 'Nivellement',
  1033: 'Optimisation vibrations',
  1034: 'Calibration PID',
  1035: 'Auto-diagnostic',
  1038: 'Suppression historique',
  1047: 'Suppression fichier',
  1051: 'Export timelapse',
  2001: 'Chargement filament',
  2002: 'Déchargement filament',
  2003: 'Filament',
  2004: 'Recharge auto',
};

const ERROR_FR: Record<number, string> = {
  1003: 'paramètre invalide',
  1009: 'imprimante occupée',
  1010: 'aucune impression en cours',
  1014: 'fichier G-code invalide',
  1017: 'clé USB absente',
  1021: 'fichier introuvable',
  1026: 'aucun maillage, lancer un nivellement',
};

type Waiter = {
  el?: HTMLElement;
  timer: ReturnType<typeof setTimeout>;
  resolve: (code: number) => void;
};

let client: WsClient | null = null;
const waiting = new Map<number, Waiter[]>();

export function bindClient(c: WsClient): void {
  client = c;
}

export function describeError(code: number | undefined): string {
  if (code === undefined) return 'erreur inconnue';
  return ERROR_FR[code] ?? describeCommandError(code);
}

/**
 * Envoie une commande MQTT. Le bouton passé reste inerte jusqu'à la réponse (ou 8 s),
 * la promesse rend le code d'erreur (-1 si aucune réponse).
 */
export function send(
  method: number,
  params: Record<string, unknown> = {},
  el?: HTMLElement,
): Promise<number> {
  if (!client) return Promise.resolve(-1);
  el?.classList.add('pending');
  return new Promise((resolve) => {
    const waiter: Waiter = {
      el,
      resolve,
      timer: setTimeout(() => {
        el?.classList.remove('pending');
        const list = waiting.get(method);
        if (list)
          waiting.set(
            method,
            list.filter((w) => w !== waiter),
          );
        resolve(-1);
      }, 8000),
    };
    if (!waiting.has(method)) waiting.set(method, []);
    waiting.get(method)!.push(waiter);
    client!.sendCommand(method, params);
  });
}

/** Lecture sans suivi : les réponses alimentent l'état, pas l'interface. */
export function query(method: number, params: Record<string, unknown> = {}): void {
  client?.sendCommand(method, params);
}

/** Appelé pour chaque réponse : libère le plus ancien appel en attente et signale l'issue. */
export function settle(method: number, data: unknown): void {
  const result = (data as { result?: { error_code?: number } })?.result;
  const code = result?.error_code ?? 0;
  const waiter = waiting.get(method)?.shift();
  if (waiter) {
    clearTimeout(waiter.timer);
    waiter.el?.classList.remove('pending');
    waiter.resolve(code);
  }
  const label = WRITE_LABELS[method];
  if (!label) return;
  const outcome = classifyCommandOutcome(code);
  if (outcome === 'busy') toast(`${label} : imprimante occupée, réessayer dans un instant`, 'warn');
  else if (outcome === 'rejected') toast(`${label} refusé : ${describeError(code)}`, 'warn');
  else if (outcome === 'error') toast(`${label} en échec : ${describeError(code)}`, 'error');
}

export async function api<T = unknown>(
  url: string,
  init: RequestInit = {},
  timeoutMs = 15000,
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      throw new Error(
        (detail as { error?: string } | null)?.error ?? `${res.status} ${res.statusText}`,
      );
    }
    const type = res.headers.get('content-type') ?? '';
    return (type.includes('json') ? await res.json() : await res.text()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
  return api<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
