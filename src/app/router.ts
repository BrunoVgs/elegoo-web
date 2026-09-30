import type { IconName } from './ui/icons';

export interface View {
  id: string;
  label: string;
  icon: IconName;
  /** Monte la vue dans `host` et rend sa fonction de nettoyage. */
  mount(host: HTMLElement): () => void;
}

type Loader = () => Promise<{ default: View['mount'] }>;

interface Route {
  id: string;
  label: string;
  icon: IconName;
  load: Loader;
}

/* Chaque vue est un module chargé à la demande : la 3D du G-code ne pèse rien tant
   qu'on ne l'ouvre pas. */
export const ROUTES: Route[] = [
  { id: 'accueil', label: 'Accueil', icon: 'home', load: () => import('./views/overview') },
  { id: 'controle', label: 'Contrôle', icon: 'control', load: () => import('./views/control') },
  { id: 'fichiers', label: 'Fichiers', icon: 'files', load: () => import('./views/files') },
  { id: 'gcode', label: 'G-code', icon: 'layers', load: () => import('./views/gcode') },
  { id: 'camera', label: 'Caméra', icon: 'camera', load: () => import('./views/camera') },
  { id: 'historique', label: 'Historique', icon: 'history', load: () => import('./views/history') },
  { id: 'journal', label: 'Journal', icon: 'log', load: () => import('./views/logs') },
  { id: 'reglages', label: 'Réglages', icon: 'settings', load: () => import('./views/settings') },
];

export function currentRoute(): Route {
  const id = location.hash.replace(/^#\/?/, '').split('?')[0];
  return ROUTES.find((r) => r.id === id) ?? ROUTES[0];
}

export function go(id: string): void {
  location.hash = `#/${id}`;
}
