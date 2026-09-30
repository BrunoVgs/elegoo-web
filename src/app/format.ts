const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const dayFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' });

export function num(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '--';
  return digits ? nf1.format(v) : nf0.format(v);
}

export function temp(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '--';
  return nf0.format(Math.round(v));
}

/** "2 h 05", "14 min", "38 s". */
export function duration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec) || sec < 0) return '--';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')}`;
  if (m > 0) return `${m} min`;
  return `${s} s`;
}

export function clock(ms: number): string {
  return timeFmt.format(ms);
}

/** Heure de fin : ajoute le jour quand ce n'est pas aujourd'hui. */
export function eta(remainingSec: number): string {
  if (!Number.isFinite(remainingSec) || remainingSec <= 0) return '--';
  const end = Date.now() + remainingSec * 1000;
  const sameDay = new Date(end).toDateString() === new Date().toDateString();
  return sameDay ? clock(end) : `${dayFmt.format(end)} ${clock(end)}`;
}

export function date(ms: number): string {
  if (!ms) return '--';
  return dateFmt.format(ms);
}

/** Horodatage relatif court : "à l'instant", "il y a 5 min", sinon la date. */
export function ago(ms: number): string {
  const d = (Date.now() - ms) / 1000;
  if (d < 45) return "à l'instant";
  if (d < 3600) return `il y a ${Math.round(d / 60)} min`;
  if (d < 86400) return `il y a ${Math.round(d / 3600)} h`;
  return date(ms);
}

export function bytes(n: number | null | undefined): string {
  if (!n || n < 0) return '--';
  const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i ? nf1.format(v) : nf0.format(v)} ${units[i]}`;
}

export function grams(g: number | null | undefined): string {
  if (g === null || g === undefined || !Number.isFinite(g)) return '--';
  return g >= 1000 ? `${nf1.format(g / 1000)} kg` : `${nf1.format(g)} g`;
}

/** Nom de fichier lisible : sans dossier, sans préfixe de tranchage ni extension. */
export function prettyFile(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.(gcode|3mf|gco|g)$/i, '');
}

export function baseName(path: string): string {
  return path.split('/').pop() ?? path;
}
