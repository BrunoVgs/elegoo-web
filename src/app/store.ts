import { ChartStore } from '../chart-store';
import { PrinterState } from '../printer-state';
import type { QueueSnapshot } from '../print-queue-shared';
import type { ConnectionState } from '../ws-client';
import { statusLabel, subStatusLabel } from './labels';

export type Topic =
  | 'status'
  | 'files'
  | 'history'
  | 'service'
  | 'ai'
  | 'events'
  | 'layers'
  | 'thumb'
  | 'queue'
  | 'raw'
  | 'connection';

export type Phase =
  | 'offline'
  | 'idle'
  | 'printing'
  | 'paused'
  | 'ended'
  | 'busy'
  | 'estop'
  | 'powerloss';

export interface AIState {
  status: string;
  config: Record<string, unknown> | null;
  last: Record<string, unknown> | null;
  alerts: Array<Record<string, unknown>>;
}

export interface RawEntry {
  ts: number;
  dir: 'sent' | 'received';
  topic: string;
  data: unknown;
}

export interface EventEntry {
  ts: number;
  event: Record<string, unknown>;
}

const PAUSED_SUB = new Set([2501, 2502, 2505]);
const ENDED_SUB = new Set([2077, 2504]);
const MAX_EVENTS = 300;
const MAX_RAW = 500;

class Store {
  readonly printer = new PrinterState();
  readonly charts = new ChartStore();
  connection: ConnectionState = 'connecting';
  printerLinked = false;
  service: Record<string, unknown> = {};
  ai: AIState = { status: 'disabled', config: null, last: null, alerts: [] };
  events: EventEntry[] = [];
  queue: QueueSnapshot | null = null;
  raw: RawEntry[] = [];

  private listeners = new Map<Topic, Set<() => void>>();
  private pending = new Set<Topic>();
  private frame = 0;

  on(topics: Topic | Topic[], fn: () => void): () => void {
    const list = Array.isArray(topics) ? topics : [topics];
    for (const t of list) {
      if (!this.listeners.has(t)) this.listeners.set(t, new Set());
      this.listeners.get(t)!.add(fn);
    }
    return () => {
      for (const t of list) this.listeners.get(t)?.delete(fn);
    };
  }

  /** Coalesce les notifications d'une même frame : un écouteur ne tourne qu'une fois. */
  emit(topic: Topic): void {
    this.pending.add(topic);
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const fired = new Set<() => void>();
      const topics = [...this.pending];
      this.pending.clear();
      for (const t of topics) {
        for (const fn of this.listeners.get(t) ?? []) {
          if (fired.has(fn)) continue;
          fired.add(fn);
          fn();
        }
      }
    });
  }

  get phase(): Phase {
    if (this.connection !== 'connected' || !this.printerLinked) return 'offline';
    const ms = this.printer.status?.machine_status;
    if (!ms) return 'offline';
    if (ms.status === 14) return 'estop';
    if (ms.status === 15) return 'powerloss';
    if (ms.status === 2) {
      if (PAUSED_SUB.has(ms.sub_status)) return 'paused';
      if (ENDED_SUB.has(ms.sub_status)) return 'ended';
      return 'printing';
    }
    if (ms.status === 1 || ms.status === 0) return 'idle';
    return 'busy';
  }

  get phaseLabel(): string {
    const ms = this.printer.status?.machine_status;
    switch (this.phase) {
      case 'offline':
        return this.connection === 'connected' ? 'Imprimante hors ligne' : 'Service injoignable';
      case 'paused':
        return subStatusLabel(ms?.sub_status) || 'En pause';
      case 'ended':
        return subStatusLabel(ms?.sub_status);
      case 'printing': {
        const sub = subStatusLabel(ms?.sub_status);
        return sub && sub !== 'Impression' ? sub : 'Impression';
      }
      default:
        return subStatusLabel(ms?.sub_status) || statusLabel(ms?.status);
    }
  }

  get isActive(): boolean {
    return this.phase === 'printing' || this.phase === 'paused';
  }

  get progress(): number {
    return this.printer.status?.machine_status?.progress ?? 0;
  }

  get totalLayers(): number {
    return this.printer.status?.print_status?.total_layer || this.printer.fileTotalLayers || 0;
  }

  pushRaw(entry: RawEntry): void {
    this.raw.push(entry);
    if (this.raw.length > MAX_RAW) this.raw.splice(0, this.raw.length - MAX_RAW);
    this.emit('raw');
  }

  pushEvent(entry: EventEntry): void {
    this.events.push(entry);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    this.emit('events');
  }
}

export const store = new Store();
