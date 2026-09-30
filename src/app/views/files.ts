import type { FileEntry } from '../../types';
import { api, postJson, query, send } from '../commands';
import { bytes, date, duration, grams, prettyFile } from '../format';
import { go } from '../router';
import { store } from '../store';
import { button, h, ico, iconButton, panel, segmented, setPressed, setText } from '../ui/dom';
import { archiveToLibrary, libraryBrowser } from '../ui/library';
import { confirm } from '../ui/modal';
import { openPrintDialog } from '../ui/print-dialog';
import { toast } from '../ui/toast';

type Source = 'local' | 'u-disk';
type View = Source | 'library';
type SortKey = 'date' | 'name' | 'size' | 'time';

interface Entry extends FileEntry {
  color_map?: Array<{ t: number; color: string; name: string }>;
}

const SORT_KEY = 'cc2-files-sort';
const SORTS: Array<{ value: SortKey; label: string }> = [
  { value: 'date', label: 'Plus récents' },
  { value: 'name', label: 'Nom' },
  { value: 'size', label: 'Taille' },
  { value: 'time', label: "Durée d'impression" },
];
const OLD_DAYS = 30;

function readSort(): SortKey {
  try {
    const v = localStorage.getItem(SORT_KEY) as SortKey | null;
    return SORTS.some((s) => s.value === v) ? v! : 'date';
  } catch {
    return 'date';
  }
}

function thumbUrl(path: string, source: Source, version?: number): string {
  return `/api/files/thumbnail?source=${source}&file=${encodeURIComponent(path)}${version ? `&v=${version}` : ''}`;
}

export default function mount(host: HTMLElement): () => void {
  let source: Source = 'local';
  let libraryMode = false;
  let dir = '/';
  let filter = '';
  let sort = readSort();
  let selecting = false;
  const selected = new Set<string>();

  const fullPath = (name: string) => (dir === '/' ? name : `${dir.replace(/^\//, '')}/${name}`);

  const openDir = (next: string) => {
    dir = next;
    refresh();
  };

  const refresh = () => {
    if (libraryMode) {
      void library.load();
      return;
    }
    query(1044, { storage_media: source, dir, offset: 0, limit: 200 });
    query(1048, { storage_media: source });
  };

  /* ---- barre d'outils ---- */

  const sourcePicker = segmented(
    [
      { value: 'local', label: 'Interne' },
      { value: 'u-disk', label: 'Clé USB' },
      { value: 'library', label: 'Bibliothèque' },
    ],
    source as View,
    (v) => {
      libraryMode = v === 'library';
      setPressed(sourcePicker, v);
      filesPanel.classList.toggle('library-mode', libraryMode);
      if (libraryMode) {
        void library.load();
        return;
      }
      source = v as Source;
      dir = '/';
      selected.clear();
      setPressed(sourcePicker, v);
      list.replaceChildren(h('div', { class: 'empty' }, 'Chargement…'));
      refresh();
    },
  );
  const search = h('input', {
    class: 'input grow',
    type: 'search',
    placeholder: 'Rechercher',
    'aria-label': 'Rechercher',
  });
  search.addEventListener('input', () => {
    filter = search.value.trim().toLowerCase();
    render();
  });
  const sortSel = h('select', { class: 'select', 'aria-label': 'Trier' });
  for (const s of SORTS) sortSel.append(h('option', { value: s.value }, s.label));
  sortSel.value = sort;
  sortSel.addEventListener('change', () => {
    sort = sortSel.value as SortKey;
    try {
      localStorage.setItem(SORT_KEY, sort);
    } catch {
      /* tri non mémorisé */
    }
    render();
  });

  const fileInput = h('input', {
    type: 'file',
    accept: '.gcode,.3mf',
    multiple: true,
    hidden: true,
  });
  fileInput.addEventListener('change', () => {
    void uploadAll([...(fileInput.files ?? [])]);
    fileInput.value = '';
  });
  const uploadBtn = button('Envoyer', {
    icon: 'upload',
    cls: 'primary',
    onClick: () => fileInput.click(),
  });
  const selectBtn = button('Sélection', {
    icon: 'check',
    cls: 'ghost',
    onClick: () => toggleSelect(),
  });

  const toolbar = h(
    'div',
    { class: 'files-toolbar' },
    sourcePicker,
    search,
    sortSel,
    selectBtn,
    iconButton('refresh', 'Actualiser', refresh),
    uploadBtn,
    fileInput,
  );

  /* ---- stockage et sélection ---- */

  const storageFill = h('span');
  const storageText = h('span', { class: 'hint num' });
  const storage = h(
    'div',
    { class: 'storage' },
    h('div', { class: 'bar' }, storageFill),
    storageText,
  );

  const selCount = h('span', { class: 'num' });
  const selBar = h(
    'div',
    { class: 'selbar hidden' },
    selCount,
    button(`Plus de ${OLD_DAYS} jours`, {
      cls: 'ghost',
      onClick: () => {
        const limit = Date.now() / 1000 - OLD_DAYS * 86400;
        for (const f of visibleFiles())
          if (f.type !== 'folder' && (f.create_time ?? 0) < limit)
            selected.add(fullPath(f.filename));
        render();
      },
    }),
    button('Tout', {
      cls: 'ghost',
      onClick: () => {
        for (const f of visibleFiles()) if (f.type !== 'folder') selected.add(fullPath(f.filename));
        render();
      },
    }),
    button('Aucun', {
      cls: 'ghost',
      onClick: () => {
        selected.clear();
        render();
      },
    }),
    h('span', { class: 'spacer' }),
    button('Supprimer', { icon: 'trash', cls: 'danger', onClick: () => void deleteSelected() }),
  );

  const upload = h('div', { class: 'upload hidden' });
  const crumbs = h('div', { class: 'crumbs' });
  const list = h('div', { class: 'list files-list' }, h('div', { class: 'empty' }, 'Chargement…'));
  const library = libraryBrowser({ filter: () => filter, sort: () => sort });
  library.el.classList.add('library');

  /* ---- file d'attente ---- */

  const queueBody = h('div', { class: 'list' });

  const filesPanel = panel(
    'Fichiers',
    h('div', {}, toolbar, storage, selBar, upload, crumbs, list, library.el),
    { flush: true },
  );
  const dropHint = h(
    'div',
    { class: 'drop-hint' },
    ico('upload'),
    "Déposer pour envoyer à l'imprimante",
  );
  filesPanel.append(dropHint);

  host.append(
    h(
      'div',
      { class: 'grid files' },
      h('div', { class: 'span-8 stack' }, filesPanel),
      h('div', { class: 'span-4 stack' }, panel("File d'attente", queueBody, { flush: true })),
    ),
  );

  /* ---- rendu ---- */

  const visibleFiles = (): Entry[] => {
    const files = (store.printer.files as Entry[]).filter(
      (f) => !filter || f.filename.toLowerCase().includes(filter),
    );
    const cmp: Record<SortKey, (a: Entry, b: Entry) => number> = {
      date: (a, b) => (b.create_time ?? 0) - (a.create_time ?? 0),
      name: (a, b) => prettyFile(a.filename).localeCompare(prettyFile(b.filename), 'fr'),
      size: (a, b) => (b.size ?? 0) - (a.size ?? 0),
      time: (a, b) => (b.print_time ?? 0) - (a.print_time ?? 0),
    };
    return files.sort((a, b) => {
      const fa = a.type === 'folder' ? 0 : 1;
      const fb = b.type === 'folder' ? 0 : 1;
      return fa - fb || cmp[sort](a, b);
    });
  };

  const renderStorage = () => {
    const cap = store.printer.storageCapacity;
    storage.classList.toggle('hidden', !cap?.total);
    if (!cap?.total) return;
    const pct = Math.round((cap.used / cap.total) * 100);
    storageFill.style.width = `${pct}%`;
    storage.classList.toggle('full', pct > 85);
    setText(
      storageText,
      `${bytes(cap.used)} utilisés sur ${bytes(cap.total)} · ${bytes(cap.free)} libres`,
    );
  };

  const row = (f: Entry): HTMLElement => {
    const path = fullPath(f.filename);
    if (f.type === 'folder') {
      return h(
        'div',
        {
          class: 'list-row file-row folder',
          onclick: () => {
            dir = dir === '/' ? `/${f.filename}` : `${dir}/${f.filename}`;
            refresh();
          },
        },
        h('div', { class: 'thumb folder-icon' }, ico('folder')),
        h('div', { class: 'list-main' }, h('div', { class: 'list-title' }, f.filename)),
      );
    }
    const img = h('img', {
      class: 'thumb',
      loading: 'lazy',
      alt: '',
      src: thumbUrl(path, source, f.create_time),
    });
    img.addEventListener(
      'error',
      () => img.replaceWith(h('div', { class: 'thumb thumb-missing' }, ico('file'))),
      { once: true },
    );
    const colors = (f.color_map ?? []).map((c) =>
      h('span', { class: 'swatch', style: `background:${c.color}`, title: c.name }),
    );
    const check = h('input', {
      type: 'checkbox',
      class: 'file-check',
      'aria-label': 'Sélectionner',
    });
    check.checked = selected.has(path);
    check.addEventListener('change', () => {
      if (check.checked) selected.add(path);
      else selected.delete(path);
      renderSelection();
    });
    const printBtn = button('Imprimer', {
      icon: 'play',
      onClick: () => {
        if (store.isActive) {
          toast('Une impression est déjà en cours', 'warn');
          return;
        }
        openPrintDialog({
          path,
          source,
          thumbUrl: thumbUrl(path, source, f.create_time),
          printTime: f.print_time,
          filament: f.total_filament_used,
          layers: f.layer,
          colorMap: f.color_map,
        });
      },
    });
    printBtn.disabled = store.isActive || store.phase === 'offline';
    return h(
      'div',
      { class: `list-row file-row ${selected.has(path) ? 'selected' : ''}`.trim() },
      selecting ? check : null,
      img,
      h(
        'div',
        { class: 'list-main' },
        h('div', { class: 'list-title', title: f.filename }, prettyFile(f.filename)),
        h(
          'div',
          { class: 'list-sub' },
          colors.length ? h('span', { class: 'row', style: 'gap:3px' }, ...colors) : null,
          f.print_time ? h('span', {}, duration(f.print_time)) : null,
          f.total_filament_used ? h('span', {}, grams(f.total_filament_used)) : null,
          f.layer ? h('span', {}, `${f.layer} couches`) : null,
          h('span', {}, bytes(f.size)),
          f.create_time ? h('span', {}, date(f.create_time * 1000)) : null,
        ),
      ),
      h(
        'div',
        { class: 'file-actions' },
        printBtn,
        iconButton('queue', "Ajouter à la file d'attente", () => void enqueue(path)),
        iconButton('layers', 'Aperçu G-code', () =>
          go(`gcode?file=${encodeURIComponent(path)}&source=${source}`),
        ),
        iconButton('download', 'Télécharger', () => {
          window.location.href = `/api/files/download?source=${source}&file=${encodeURIComponent(path)}`;
        }),
        iconButton(
          'hdd',
          'Archiver dans la bibliothèque',
          (e) => void archiveToLibrary(path, source, e.currentTarget as HTMLElement),
        ),
        iconButton('trash', 'Supprimer', () => void deleteFiles([path])),
      ),
    );
  };

  const renderSelection = () => {
    selBar.classList.toggle('hidden', !selecting);
    const size = (store.printer.files as Entry[])
      .filter((f) => selected.has(fullPath(f.filename)))
      .reduce((s, f) => s + (f.size ?? 0), 0);
    setText(
      selCount,
      `${selected.size} sélectionné${selected.size > 1 ? 's' : ''} · ${bytes(size) === '--' ? '0 o' : bytes(size)}`,
    );
    for (const r of list.querySelectorAll<HTMLElement>('.file-row')) {
      const c = r.querySelector<HTMLInputElement>('.file-check');
      r.classList.toggle('selected', !!c?.checked);
    }
  };

  const render = () => {
    if (libraryMode) {
      library.render();
      return;
    }
    renderStorage();
    const parts = dir.split('/').filter(Boolean);
    crumbs.replaceChildren(
      h(
        'button',
        { type: 'button', class: 'crumb', onclick: () => openDir('/') },
        source === 'local' ? 'Interne' : 'USB',
      ),
      ...parts.map((p, i) =>
        h(
          'button',
          {
            type: 'button',
            class: 'crumb',
            onclick: () => openDir(`/${parts.slice(0, i + 1).join('/')}`),
          },
          p,
        ),
      ),
    );
    crumbs.classList.toggle('hidden', parts.length === 0);
    const files = visibleFiles();
    list.replaceChildren(
      ...(files.length
        ? files.map(row)
        : [
            h(
              'div',
              { class: 'empty' },
              filter
                ? 'Aucun fichier ne correspond'
                : source === 'u-disk'
                  ? 'Aucune clé USB ou clé vide'
                  : 'Aucun fichier',
            ),
          ]),
    );
    renderSelection();
  };

  const toggleSelect = () => {
    selecting = !selecting;
    selected.clear();
    selectBtn.classList.toggle('active', selecting);
    render();
  };

  /* ---- actions ---- */

  const deleteFiles = async (paths: string[]) => {
    const names = paths.map((p) => prettyFile(p));
    const ok = await confirm(
      paths.length > 1 ? `Supprimer ${paths.length} fichiers` : 'Supprimer le fichier',
      h(
        'div',
        {},
        h('p', { style: 'margin-top:0' }, "Suppression définitive sur l'imprimante :"),
        h('ul', { class: 'del-list' }, ...names.slice(0, 12).map((n) => h('li', {}, n))),
        names.length > 12 ? h('p', {}, `et ${names.length - 12} autres`) : null,
      ),
      { ok: 'Supprimer', tone: 'danger' },
    );
    if (!ok) return;
    const code = await send(1047, { storage_media: source, file_path: paths });
    if (code === 0) {
      toast(paths.length > 1 ? `${paths.length} fichiers supprimés` : 'Fichier supprimé', 'ok');
      for (const p of paths) selected.delete(p);
    }
    refresh();
  };

  const deleteSelected = () => {
    if (!selected.size) {
      toast('Aucun fichier sélectionné', 'info');
      return;
    }
    return deleteFiles([...selected]);
  };

  const uploadAll = async (files: File[]) => {
    for (const file of files) {
      if (!/\.(gcode|3mf)$/i.test(file.name)) {
        toast(`${file.name} : seuls les .gcode et .3mf sont acceptés`, 'warn');
        continue;
      }
      const fill = h('span');
      const label = h('span', { class: 'num' }, `${file.name} · 0 %`);
      upload.replaceChildren(h('div', { class: 'bar' }, fill), label);
      upload.classList.remove('hidden');
      try {
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', `/api/files/upload?source=${source}`);
          xhr.upload.addEventListener('progress', (e) => {
            if (!e.lengthComputable) return;
            const pct = Math.round((e.loaded / e.total) * 100);
            fill.style.width = `${pct}%`;
            setText(label, `${file.name} · ${pct} % · ${bytes(e.loaded)} / ${bytes(e.total)}`);
          });
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve();
            else {
              let msg = `HTTP ${xhr.status}`;
              try {
                msg = JSON.parse(xhr.responseText).error ?? msg;
              } catch {
                /* réponse non JSON */
              }
              reject(new Error(msg));
            }
          };
          xhr.onerror = () => reject(new Error('réseau'));
          const form = new FormData();
          form.append('file', file);
          xhr.send(form);
        });
        toast(`${file.name} envoyé`, 'ok');
      } catch (err) {
        toast(`Envoi de ${file.name} en échec : ${(err as Error).message}`, 'error');
      }
    }
    upload.classList.add('hidden');
    refresh();
  };

  const enqueue = async (path: string) => {
    try {
      await postJson('/api/queue/items', { filename: path, source });
      toast("Ajouté à la file d'attente", 'ok');
    } catch (err) {
      toast(`File d'attente : ${(err as Error).message}`, 'error');
    }
  };

  const renderQueue = () => {
    const q = store.queue;
    const rows: Node[] = [];
    if (q?.hold) {
      rows.push(
        h(
          'div',
          { class: 'list-row queue-hold' },
          ico('alert'),
          h(
            'div',
            { class: 'list-main' },
            h('div', { class: 'list-title' }, 'File suspendue'),
            h('div', { class: 'list-sub' }, q.hold.reason),
          ),
          button('Relancer', {
            cls: 'ghost',
            onClick: async () => {
              await postJson('/api/queue/resume', {}).catch(() => undefined);
              void loadQueue();
            },
          }),
        ),
      );
    }
    if (q?.active) {
      rows.push(
        h(
          'div',
          { class: 'list-row' },
          ico('play'),
          h(
            'div',
            { class: 'list-main' },
            h('div', { class: 'list-title' }, prettyFile(q.active.item.filename)),
            h('div', { class: 'list-sub' }, 'en cours'),
          ),
        ),
      );
    }
    for (const [i, item] of (q?.items ?? []).entries()) {
      rows.push(
        h(
          'div',
          { class: 'list-row' },
          h('span', { class: 'queue-idx num' }, String(i + 1)),
          h('img', {
            class: 'thumb sm',
            loading: 'lazy',
            alt: '',
            src: thumbUrl(item.filename, item.source as Source),
          }),
          h(
            'div',
            { class: 'list-main' },
            h('div', { class: 'list-title' }, prettyFile(item.filename)),
            h('div', { class: 'list-sub' }, item.source === 'u-disk' ? 'Clé USB' : 'Interne'),
          ),
          i === 0
            ? button('Lancer', {
                icon: 'play',
                cls: 'primary',
                onClick: () => {
                  const f = (store.printer.files as Entry[]).find(
                    (e) => fullPath(e.filename) === item.filename,
                  );
                  openPrintDialog({
                    path: item.filename,
                    source: item.source as Source,
                    queueId: item.id,
                    thumbUrl: thumbUrl(item.filename, item.source as Source),
                    printTime: f?.print_time,
                    filament: f?.total_filament_used,
                    layers: f?.layer,
                    colorMap: f?.color_map,
                  });
                },
              })
            : null,
          iconButton('x', 'Retirer', async () => {
            await api(`/api/queue/items/${item.id}`, { method: 'DELETE' }).catch(() => undefined);
            void loadQueue();
          }),
        ),
      );
    }
    if (!rows.length)
      rows.push(
        h(
          'div',
          { class: 'empty' },
          "Aucun travail en attente. Le bouton de file d'une ligne de fichier en ajoute un.",
        ),
      );
    queueBody.replaceChildren(...rows);
  };

  const loadQueue = async () => {
    try {
      const res = await api<{ queue: typeof store.queue }>('/api/queue');
      store.queue = res.queue;
      store.emit('queue');
    } catch {
      /* file indisponible : rendu vide */
    }
  };

  /* ---- glisser-déposer ---- */

  let dragDepth = 0;
  const onDragEnter = (e: DragEvent) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    dragDepth++;
    filesPanel.classList.add('dropping');
  };
  const onDragLeave = () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) filesPanel.classList.remove('dropping');
  };
  const onDragOver = (e: DragEvent) => e.preventDefault();
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    dragDepth = 0;
    filesPanel.classList.remove('dropping');
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length) void uploadAll(files);
  };
  filesPanel.addEventListener('dragenter', onDragEnter);
  filesPanel.addEventListener('dragleave', onDragLeave);
  filesPanel.addEventListener('dragover', onDragOver);
  filesPanel.addEventListener('drop', onDrop);

  const offFiles = store.on('files', render);
  // Les boutons Imprimer suivent l'état de la machine : rendu seulement quand la phase change.
  let lastPhase = store.phase;
  const offStatus = store.on(['connection', 'status'], () => {
    if (store.phase === lastPhase) return;
    lastPhase = store.phase;
    render();
  });
  const offQueue = store.on('queue', renderQueue);
  render();
  renderQueue();
  refresh();
  void loadQueue();

  return () => {
    offFiles();
    offStatus();
    offQueue();
  };
}
