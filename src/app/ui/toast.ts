import { $, h, ico } from './dom';
import type { IconName } from './icons';

export type Tone = 'ok' | 'warn' | 'error' | 'info';

const ICONS: Record<Tone, IconName> = {
  ok: 'check',
  warn: 'alert',
  error: 'octagon',
  info: 'info',
};
const recent = new Map<string, number>();

export function toast(message: string, tone: Tone = 'info', ms = 4200): void {
  // Un même message répété dans la seconde (rafales de réponses) n'est affiché qu'une fois.
  const now = Date.now();
  if ((recent.get(message) ?? 0) > now - 1000) return;
  recent.set(message, now);

  const el = h(
    'div',
    { class: `toast ${tone}`, role: 'status' },
    ico(ICONS[tone]),
    h('span', {}, message),
  );
  const host = $('toasts');
  host.append(el);
  while (host.children.length > 4) host.firstElementChild?.remove();
  const leave = () => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 220);
  };
  el.addEventListener('click', leave);
  setTimeout(leave, ms);
}
