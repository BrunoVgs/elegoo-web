import { icon, type IconName } from './icons';

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;

/**
 * Crée un élément. Les clés `on*` deviennent des écouteurs, une valeur `false`/`null`
 * omet l'attribut. Le contenu passe toujours par des nœuds texte, jamais par innerHTML.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2), value);
    } else if (value === true) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, String(value));
    }
  }
  append(el, children);
  return el;
}

export function append(el: Element, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
}

export function ico(name: IconName, cls = ''): SVGElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = icon(name);
  const svg = tpl.content.firstElementChild as SVGElement;
  if (cls) svg.setAttribute('class', cls);
  return svg;
}

export function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} absent`);
  return el;
}

/** Remplace le texte seulement s'il change : évite de casser une sélection en cours. */
export function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export function button(
  label: string,
  opts: { icon?: IconName; cls?: string; title?: string; onClick?: (e: MouseEvent) => void } = {},
): HTMLButtonElement {
  return h(
    'button',
    {
      type: 'button',
      class: `btn ${opts.cls ?? ''}`.trim(),
      title: opts.title,
      onclick: opts.onClick as EventListener | undefined,
    },
    opts.icon ? ico(opts.icon) : null,
    label || null,
  );
}

export function iconButton(
  name: IconName,
  title: string,
  onClick: (e: MouseEvent) => void,
  cls = '',
): HTMLButtonElement {
  return h(
    'button',
    {
      type: 'button',
      class: `icon-btn ${cls}`.trim(),
      title,
      'aria-label': title,
      onclick: onClick as EventListener,
    },
    ico(name),
  );
}

export function panel(
  title: string,
  body: Node,
  opts: { actions?: Node[]; cls?: string; flush?: boolean; id?: string } = {},
): HTMLElement {
  return h(
    'section',
    { class: `panel ${opts.cls ?? ''}`.trim(), id: opts.id },
    h(
      'header',
      { class: 'panel-head' },
      h('h2', { class: 'panel-title' }, title),
      opts.actions?.length ? h('div', { class: 'panel-actions' }, ...opts.actions) : null,
    ),
    h('div', { class: opts.flush ? 'panel-body flush' : 'panel-body' }, body),
  );
}

export function pill(text: string, tone = '', extra = ''): HTMLSpanElement {
  return h('span', { class: `pill ${tone} ${extra}`.trim() }, text);
}

export function stat(label: string, value: string | Node): HTMLElement {
  return h(
    'div',
    { class: 'stat' },
    h('span', { class: 'stat-label' }, label),
    h('span', { class: 'stat-value' }, value),
  );
}

export function switchInput(checked: boolean, onChange: (on: boolean) => void): HTMLLabelElement {
  const input = h('input', { type: 'checkbox' });
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'switch' }, input, h('span'));
}

/** Boutons exclusifs ; `aria-pressed` porte l'état. */
export function segmented<T extends string | number>(
  options: Array<{ value: T; label: string }>,
  current: T | null,
  onPick: (value: T) => void,
  cls = '',
): HTMLElement {
  const wrap = h('div', { class: `segmented ${cls}`.trim(), role: 'group' });
  for (const opt of options) {
    wrap.append(
      h(
        'button',
        {
          type: 'button',
          'data-value': String(opt.value),
          'aria-pressed': String(opt.value === current),
          onclick: () => onPick(opt.value),
        },
        opt.label,
      ),
    );
  }
  return wrap;
}

export function setPressed(group: HTMLElement, value: string | number | null): void {
  for (const b of group.querySelectorAll<HTMLButtonElement>('button[data-value]')) {
    b.setAttribute('aria-pressed', String(b.dataset.value === String(value)));
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
