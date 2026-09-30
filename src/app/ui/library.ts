import { api, postJson } from '../commands';
import { bytes, date } from '../format';
import { go } from '../router';
import { h, ico, iconButton } from './dom';
import type { IconName } from './icons';
import { toast } from './toast';

interface LibEntry {
  name: string;
  type: 'dir' | 'file';
  size: number;
  mtime: number;
}

export type LibSort = 'date' | 'name' | 'size' | 'time';

const ICONS: Record<string, IconName> = {
  gcode: 'layers',
  stl: 'grid',
  '3mf': 'grid',
  glb: 'grid',
  jpg: 'camera',
  png: 'camera',
  mp4: 'film',
};

function ext(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

export function fileUrl(path: string, download = false): string {
  return `/api/library/file?path=${encodeURIComponent(path)}${download ? '&download=1' : ''}`;
}

/**
 * Explorateur du dossier d'impressions partagé avec le NAS (LIBRARY_DIR côté service) :
 * les mêmes STL, 3MF et G-code que dans filebrowser.
 */
export function libraryBrowser(opts: { filter: () => string; sort: () => LibSort }) {
  let dir = '';
  let entries: LibEntry[] = [];
  const crumbs = h('div', { class: 'crumbs' });
  const list = h('div', { class: 'list files-list' });
  const el = h('div', {}, crumbs, list);

  const join = (name: string) => (dir ? `${dir}/${name}` : name);

  const sendToPrinter = async (path: string, btn: HTMLElement) => {
    btn.classList.add('pending');
    try {
      await postJson('/api/library/send', { path });
      toast(`${path.split('/').pop()} envoyé sur l'imprimante`, 'ok');
    } catch (err) {
      toast(`Envoi en échec : ${(err as Error).message}`, 'error');
    } finally {
      btn.classList.remove('pending');
    }
  };

  const row = (e: LibEntry): HTMLElement => {
    const path = join(e.name);
    if (e.type === 'dir') {
      return h(
        'div',
        { class: 'list-row file-row folder', onclick: () => open(path) },
        h('div', { class: 'thumb folder-icon' }, ico('folder')),
        h(
          'div',
          { class: 'list-main' },
          h('div', { class: 'list-title' }, e.name),
          h('div', { class: 'list-sub' }, date(e.mtime)),
        ),
      );
    }
    const kind = ext(e.name);
    const actions: HTMLElement[] = [];
    if (kind === 'gcode') {
      const sendBtn = h(
        'button',
        { type: 'button', class: 'btn' },
        ico('upload'),
        "Vers l'imprimante",
      );
      sendBtn.addEventListener('click', () => void sendToPrinter(path, sendBtn));
      actions.push(
        sendBtn,
        iconButton('layers', 'Aperçu G-code', () =>
          go(`gcode?file=${encodeURIComponent(path)}&source=library`),
        ),
      );
    }
    if (kind === 'stl') {
      actions.push(
        iconButton('eye', 'Aperçu 3D', async () => {
          const { openStlViewer } = await import('./stl-viewer');
          openStlViewer(fileUrl(path), e.name);
        }),
      );
    }
    actions.push(
      iconButton('download', 'Télécharger', () => window.open(fileUrl(path, true), '_blank')),
    );
    return h(
      'div',
      { class: 'list-row file-row' },
      h('div', { class: 'thumb thumb-missing' }, ico(ICONS[kind] ?? 'file')),
      h(
        'div',
        { class: 'list-main' },
        h('div', { class: 'list-title', title: e.name }, e.name),
        h(
          'div',
          { class: 'list-sub' },
          h('span', { class: 'mono' }, kind.toUpperCase()),
          h('span', {}, bytes(e.size)),
          h('span', {}, date(e.mtime)),
        ),
      ),
      h('div', { class: 'file-actions' }, ...actions),
    );
  };

  const render = () => {
    const parts = dir.split('/').filter(Boolean);
    crumbs.replaceChildren(
      h('button', { type: 'button', class: 'crumb', onclick: () => open('') }, 'Bibliothèque'),
      ...parts.map((p, i) =>
        h(
          'button',
          { type: 'button', class: 'crumb', onclick: () => open(parts.slice(0, i + 1).join('/')) },
          p,
        ),
      ),
    );
    const f = opts.filter();
    const sort = opts.sort();
    const shown = entries
      .filter((e) => !f || e.name.toLowerCase().includes(f))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        if (sort === 'name') return a.name.localeCompare(b.name, 'fr');
        if (sort === 'size') return b.size - a.size;
        return b.mtime - a.mtime;
      });
    list.replaceChildren(
      ...(shown.length ? shown.map(row) : [h('div', { class: 'empty' }, 'Dossier vide')]),
    );
  };

  async function open(next: string): Promise<void> {
    list.replaceChildren(h('div', { class: 'empty' }, 'Chargement…'));
    try {
      const res = await api<{ dir: string; entries: LibEntry[] }>(
        `/api/library?dir=${encodeURIComponent(next)}`,
      );
      dir = res.dir;
      entries = res.entries;
      render();
    } catch (err) {
      list.replaceChildren(
        h('div', { class: 'empty' }, `Bibliothèque indisponible : ${(err as Error).message}`),
      );
    }
  }

  return { el, load: () => open(dir), render };
}

/** Copie dans la bibliothèque (dossier GCODEs) un G-code présent sur l'imprimante. */
export async function archiveToLibrary(
  file: string,
  source: string,
  btn?: HTMLElement,
): Promise<void> {
  btn?.classList.add('pending');
  try {
    const res = await postJson<{ path: string }>('/api/library/archive', { file, source });
    toast(`Archivé dans ${res.path}`, 'ok');
  } catch (err) {
    toast(`Archivage en échec : ${(err as Error).message}`, 'error');
  } finally {
    btn?.classList.remove('pending');
  }
}
