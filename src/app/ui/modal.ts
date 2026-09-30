import { button, h, iconButton } from './dom';

interface ModalOptions {
  title: string;
  body: Node | string;
  actions?: HTMLButtonElement[];
  wide?: boolean;
  onClose?: () => void;
}

/** Ouvre une modale ; Échap, le fond et la croix la ferment. Rend la fonction de fermeture. */
export function openModal(opts: ModalOptions): () => void {
  const previous = document.activeElement as HTMLElement | null;
  const scrim = h('div', { class: 'modal-scrim' });
  const close = () => {
    if (!scrim.isConnected) return;
    scrim.remove();
    document.removeEventListener('keydown', onKey);
    opts.onClose?.();
    previous?.focus?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  const box = h(
    'div',
    { class: `modal ${opts.wide ? 'wide' : ''}`.trim(), role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'modal-head' }, h('span', {}, opts.title), iconButton('x', 'Fermer', close)),
    h('div', { class: 'modal-body' }, opts.body),
    opts.actions?.length ? h('div', { class: 'modal-foot' }, ...opts.actions) : null,
  );
  scrim.append(box);
  scrim.addEventListener('mousedown', (e) => {
    if (e.target === scrim) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.append(scrim);
  (box.querySelector('.modal-foot .btn:last-child') as HTMLElement | null)?.focus();
  return close;
}

/** Confirmation explicite, indispensable avant toute action qui fait bouger la machine. */
export function confirm(
  title: string,
  message: string | Node,
  opts: { ok?: string; tone?: 'danger' | 'primary' | 'warn' } = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    let decided = false;
    const done = (value: boolean) => {
      if (decided) return;
      decided = true;
      close();
      resolve(value);
    };
    const close = openModal({
      title,
      body: typeof message === 'string' ? h('p', { style: 'margin:0' }, message) : message,
      actions: [
        button('Annuler', { cls: 'ghost', onClick: () => done(false) }),
        button(opts.ok ?? 'Confirmer', { cls: opts.tone ?? 'primary', onClick: () => done(true) }),
      ],
      onClose: () => done(false),
    });
  });
}
