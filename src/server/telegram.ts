/**
 * Bot Telegram : notifications et commandes à distance, branché sur le StateStore partagé.
 * Aucune connexion MQTT propre ; les commandes passent par le pont unique du service.
 */

import { Bot, InlineKeyboard, InputFile, InputMediaBuilder } from 'grammy';
import type { Context } from 'grammy';
import type { StateStore, PrintEvent } from './state-store.js';
import type { MqttBridge } from './mqtt-bridge.js';
import type { ServiceConfig } from './config.js';
import { getSnapshot } from './rest-api.js';
import {
  CRITICAL_EXCEPTIONS,
  EXCEPTION_NAMES,
  SPEED_MODE_NAMES,
  SUB_STATUS_NAMES,
} from '../types.js';
import { isAllowedSender } from './allowlist.js';
import { classifyOtaTransition, otaPhaseName } from './ota-status.js';
import type { AIAlert } from './ai-monitor.js';
import { getLogger } from './logger.js';

const log = getLogger('Telegram');

const TZ = 'Europe/Paris';
const PAUSED_SUB = new Set([2501, 2502, 2505]);

const ISSUE_FR: Record<string, string> = {
  spaghetti: 'spaghetti',
  bed_adhesion: 'pièce décollée',
  stringing: 'fils',
  layer_shift: 'décalage de couche',
  warping: 'warping',
  blob: 'amas sur la buse',
  empty_bed: 'plateau vide',
  stall: 'impression figée',
};

/** Échappe les caractères réservés de MarkdownV2. */
function esc(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

/** Filet de sécurité : un `|` oublié non échappé fait rejeter le message entier. */
function safeCaption(text: string): string {
  return text.replace(/(?<!\\)([|])/g, '\\$1');
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')}`;
  return `${m} min`;
}

function clock(date: Date, withSeconds = false): string {
  return date.toLocaleTimeString('fr-FR', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
  });
}

function progressBar(pct: number, length = 20): string {
  const filled = Math.round((pct / 100) * length);
  return '█'.repeat(filled) + '░'.repeat(length - filled);
}

function prettyFile(name: string): string {
  return (name.split('/').pop() ?? name).replace(/\.(gcode|3mf)$/i, '');
}

/**
 * Texte Telegram (MarkdownV2) d'un événement d'impression. Exporté pour tester le libellé
 * et le choix des événements notifiés sans démarrer de bot : `text` vide = rien n'est envoyé.
 */
export function formatEvent(event: PrintEvent): { text: string; urgent: boolean } {
  switch (event.type) {
    case 'connected':
      return { text: `🟢 *Imprimante connectée*\nN° de série : \`${event.sn}\``, urgent: false };
    case 'disconnected':
      return { text: '🔴 *Imprimante déconnectée*', urgent: true };
    case 'print_started':
      return {
        text: `🚀 *Impression lancée*\n📄 ${esc(prettyFile(event.filename))}`,
        urgent: false,
      };
    case 'print_completed':
      return {
        text: `✅ *Impression terminée*\n📄 ${esc(prettyFile(event.filename))}\n⏱ Durée : ${esc(formatDuration(event.duration))}`,
        urgent: false,
      };
    case 'print_failed':
      return {
        text: `❌ *Impression interrompue*\n📄 ${esc(prettyFile(event.filename))}\n💬 ${esc(event.reason)}`,
        urgent: true,
      };
    case 'print_progress': {
      const now = new Date();
      const eta = new Date(now.getTime() + event.remaining * 1000);
      const sameDay = eta.toDateString() === now.toDateString();
      const etaStr = `${sameDay ? '' : 'demain '}${clock(eta)}`;
      const layerStr = event.totalLayers
        ? `Couche ${event.layer} sur ${event.totalLayers}`
        : `Couche ${event.layer}`;
      return {
        text: [
          `📊 *Impression : ${event.progress} %*`,
          `\`${progressBar(event.progress)}\``,
          `📄 ${esc(prettyFile(event.filename))}`,
          `📐 ${esc(layerStr)}`,
          `⏱ Restant : ${esc(formatDuration(event.remaining))}`,
          `🏁 Fin prévue : ${esc(etaStr)}`,
          `🕐 Mis à jour à ${esc(clock(now, true))}`,
        ].join('\n'),
        urgent: false,
      };
    }
    case 'error': {
      const hasCritical = event.codes.some((c) => CRITICAL_EXCEPTIONS.has(c));
      const lines = event.names.map((name, i) => {
        const code = event.codes[i];
        const icon = CRITICAL_EXCEPTIONS.has(code) ? '🚨' : '⚠️';
        return `${icon} ${esc(name)} \\(${code}\\)`;
      });
      return {
        text: `${hasCritical ? '🚨' : '⚠️'} *Erreur imprimante*\n${lines.join('\n')}`,
        urgent: hasCritical,
      };
    }
    case 'filament_runout':
      return {
        text: "🧵 *Fin de filament*\nL'impression est en pause, charger une nouvelle bobine\\.",
        urgent: true,
      };
    case 'first_layer_complete':
      return {
        text: `🥇 *Première couche terminée*\n📄 ${esc(prettyFile(event.filename))}\n⏱ Durée de la couche : ${esc(formatDuration(event.durationSec))}\nVérifier l'adhérence sur la photo\\.`,
        urgent: false,
      };
    case 'sub_status_change':
      return formatOtaTransition(event);
    default:
      return { text: '', urgent: false };
  }
}

/**
 * Mise à jour du firmware, en lecture seule : un message à l'entrée, un à la sortie,
 * jamais à chaque étape intermédiaire. Aucune commande OTA n'est envoyée d'ici.
 */
function formatOtaTransition(event: Extract<PrintEvent, { type: 'sub_status_change' }>): {
  text: string;
  urgent: boolean;
} {
  switch (classifyOtaTransition(event.fromCode, event.toCode)) {
    case 'entered':
      return {
        text: `⚠️ *Mise à jour du firmware en cours : ne pas éteindre l'imprimante\\.*\n🔧 Étape : ${esc(otaPhaseName(event.toCode))}`,
        urgent: true,
      };
    case 'completed':
      return {
        text: "✅ *Mise à jour du firmware terminée*\nL'imprimante redémarre toute seule\\.",
        urgent: false,
      };
    case 'failed':
      return {
        text: `❌ *Mise à jour du firmware en échec*\n🔧 Dernière étape : ${esc(otaPhaseName(event.fromCode))}`,
        urgent: true,
      };
    case 'ended':
      return {
        text: `ℹ️ *Mise à jour du firmware terminée*\nÉtat actuel : ${esc(event.to)}`,
        urgent: false,
      };
    default:
      return { text: '', urgent: false };
  }
}

type Phase = 'printing' | 'paused' | 'other';

export class TelegramIntegration {
  private bot: Bot;
  private liveMessageId: number | null = null;
  private eventQueue: Promise<void> = Promise.resolve();
  private _running = false;

  constructor(
    private store: StateStore,
    private bridge: MqttBridge,
    private config: ServiceConfig,
  ) {
    this.bot = new Bot(config.telegramToken);
    this.registerCommands();

    // Événements sérialisés : deux messages ne se croisent jamais.
    store.on('print_event', (event: PrintEvent) => {
      log.info(`Event: ${event.type}`);
      this.eventQueue = this.eventQueue
        .then(() => this.handleEvent(event))
        .catch((err) => {
          log.error(`Unhandled error in event handler: ${(err as Error).message}`);
        });
    });

    // Autre imprimante : le message de progression en cours appartenait à la précédente.
    store.on('printer_switched', () => {
      this.liveMessageId = null;
    });
  }

  private get phase(): Phase {
    const ms = this.store.status?.machine_status;
    if (ms?.status !== 2) return 'other';
    return PAUSED_SUB.has(ms.sub_status) ? 'paused' : 'printing';
  }

  /** Boutons sous un message : photo toujours, pause ou reprise selon l'état. */
  private keyboard(): InlineKeyboard {
    const kb = new InlineKeyboard().text('📷 Photo', 'photo');
    if (this.phase === 'printing') kb.text('⏸ Pause', 'ask:pause');
    if (this.phase === 'paused') kb.text('▶️ Reprendre', 'ask:resume');
    return kb;
  }

  private statusText(): string {
    const s = this.store.status;
    if (!s) return 'État inconnu \\(imprimante non connectée\\)';
    const ms = s.machine_status;
    const ps = s.print_status;
    const lines: string[] = [];
    const sub = SUB_STATUS_NAMES[ms?.sub_status ?? 0];
    lines.push(
      `*État :* ${esc(this.phase === 'paused' ? 'en pause' : this.phase === 'printing' ? 'impression' : 'au repos')}${sub ? ` \\(${esc(sub)}\\)` : ''}`,
    );
    lines.push(
      `🌡 *Buse :* ${Math.round(s.extruder?.temperature ?? 0)} °C${s.extruder?.target ? ` → ${s.extruder.target} °C` : ''}`,
    );
    lines.push(
      `🌡 *Plateau :* ${Math.round(s.heater_bed?.temperature ?? 0)} °C${s.heater_bed?.target ? ` → ${s.heater_bed.target} °C` : ''}`,
    );
    if (s.ztemperature_sensor?.temperature)
      lines.push(`🌡 *Caisson :* ${Math.round(s.ztemperature_sensor.temperature)} °C`);
    if (ms?.status === 2 && ps) {
      const total = ps.total_layer || this.store.fileTotalLayers || 0;
      lines.push('');
      lines.push(`📄 ${esc(prettyFile(ps.filename || '?'))}`);
      lines.push(`📊 *Progression :* ${ms.progress ?? 0} %`);
      lines.push(`📐 *Couche :* ${ps.current_layer ?? '?'}${total ? ` sur ${total}` : ''}`);
      lines.push(`⏱ *Restant :* ${esc(formatDuration(ps.remaining_time_sec ?? 0))}`);
      lines.push(`⚡ *Vitesse :* ${esc(SPEED_MODE_NAMES[s.gcode_move?.speed_mode ?? 1] ?? '')}`);
    }
    const errors = ms?.exception_status ?? [];
    if (errors.length)
      lines.push(
        `\n⚠️ *Erreurs :* ${esc(errors.map((c) => EXCEPTION_NAMES[c] ?? `code ${c}`).join(', '))}`,
      );
    return lines.join('\n');
  }

  private registerCommands(): void {
    // Filtre d'expéditeur AVANT tout gestionnaire : une commande ajoutée plus tard est
    // protégée d'office. Silencieux : répondre confirmerait l'existence du bot.
    const allowed = this.config.telegramAllowedChatIds;
    this.bot.use(async (ctx, next) => {
      if (isAllowedSender(allowed, ctx.from?.id)) {
        await next();
        return;
      }
      log.warn(`Ignoring update from unauthorised sender ${ctx.from?.id ?? 'unknown'}`);
    });

    const help =
      '🖨 *Centauri Carbon 2*\n\n' +
      '/status : état et photo\n' +
      '/photo : photo de la caméra\n' +
      "/pause : mettre l'impression en pause\n" +
      "/resume : reprendre l'impression";

    this.bot.command(['start', 'help'], async (ctx) => {
      await ctx.reply(help, { parse_mode: 'MarkdownV2' });
    });

    this.bot.command('status', (ctx) => this.replyStatus(ctx));
    this.bot.command('photo', (ctx) => this.replyPhoto(ctx));
    this.bot.command('pause', (ctx) => this.askConfirm(ctx, 'pause'));
    this.bot.command('resume', (ctx) => this.askConfirm(ctx, 'resume'));

    this.bot.callbackQuery('photo', async (ctx) => {
      await ctx.answerCallbackQuery();
      await this.replyPhoto(ctx);
    });
    this.bot.callbackQuery(/^ask:(pause|resume)$/, async (ctx) => {
      await ctx.answerCallbackQuery();
      await this.askConfirm(ctx, ctx.match[1] as 'pause' | 'resume');
    });
    this.bot.callbackQuery(/^do:(pause|resume)$/, async (ctx) => {
      const action = ctx.match[1] as 'pause' | 'resume';
      const expected: Phase = action === 'pause' ? 'printing' : 'paused';
      // L'état a pu changer entre la question et la réponse : on revérifie.
      if (this.phase !== expected) {
        await ctx.answerCallbackQuery({
          text:
            action === 'pause' ? 'Aucune impression en cours' : "L'impression n'est pas en pause",
        });
        await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
        return;
      }
      this.bridge.sendCommand(action === 'pause' ? 1021 : 1023, {});
      log.info(`Telegram: ${action} sent by ${ctx.from?.id}`);
      await ctx.answerCallbackQuery({
        text: action === 'pause' ? 'Pause envoyée' : 'Reprise envoyée',
      });
      await ctx
        .editMessageText(
          action === 'pause'
            ? "⏸ Pause envoyée à l'imprimante\\."
            : "▶️ Reprise envoyée à l'imprimante\\.",
          { parse_mode: 'MarkdownV2' },
        )
        .catch(() => undefined);
    });
    this.bot.callbackQuery('cancel', async (ctx) => {
      await ctx.answerCallbackQuery({ text: 'Annulé' });
      await ctx.deleteMessage().catch(() => undefined);
    });
  }

  private async askConfirm(ctx: Context, action: 'pause' | 'resume'): Promise<void> {
    const expected: Phase = action === 'pause' ? 'printing' : 'paused';
    if (this.phase !== expected) {
      await ctx.reply(
        action === 'pause' ? 'Aucune impression en cours\\.' : "L'impression n'est pas en pause\\.",
        { parse_mode: 'MarkdownV2' },
      );
      return;
    }
    const file = esc(prettyFile(this.store.status?.print_status?.filename ?? ''));
    const text = action === 'pause' ? `Mettre en pause *${file}* ?` : `Reprendre *${file}* ?`;
    await ctx.reply(text, {
      parse_mode: 'MarkdownV2',
      reply_markup: new InlineKeyboard()
        .text(
          action === 'pause' ? '⏸ Confirmer la pause' : '▶️ Confirmer la reprise',
          `do:${action}`,
        )
        .text('Annuler', 'cancel'),
    });
  }

  private async replyStatus(ctx: Context): Promise<void> {
    const text = safeCaption(this.statusText());
    const photo = this.config.cameraEnabled ? await getSnapshot(this.config) : null;
    if (photo) {
      await ctx.replyWithPhoto(new InputFile(photo, 'snapshot.jpg'), {
        caption: text,
        parse_mode: 'MarkdownV2',
        reply_markup: this.keyboard(),
      });
    } else {
      await ctx.reply(text, { parse_mode: 'MarkdownV2', reply_markup: this.keyboard() });
    }
  }

  private async replyPhoto(ctx: Context): Promise<void> {
    if (!this.config.cameraEnabled) {
      await ctx.reply('📷 Caméra désactivée dans la configuration\\.', {
        parse_mode: 'MarkdownV2',
      });
      return;
    }
    const photo = await getSnapshot(this.config);
    if (!photo) {
      await ctx.reply('📷 Caméra injoignable\\.', { parse_mode: 'MarkdownV2' });
      return;
    }
    await ctx.replyWithPhoto(new InputFile(photo, 'snapshot.jpg'), {
      caption: `📷 ${clock(new Date(), true)}`,
      reply_markup: this.keyboard(),
    });
  }

  private async handleEvent(event: PrintEvent): Promise<void> {
    const { text, urgent } = formatEvent(event);
    if (!text) return;

    try {
      const wantPhoto =
        this.config.cameraEnabled &&
        [
          'print_started',
          'print_completed',
          'print_failed',
          'print_progress',
          'first_layer_complete',
        ].includes(event.type);
      const photo = wantPhoto ? await getSnapshot(this.config) : null;
      const withButtons = [
        'print_started',
        'print_progress',
        'first_layer_complete',
        'filament_runout',
        'error',
      ].includes(event.type);

      // Progression : le message en cours est modifié sur place.
      if (event.type === 'print_progress') {
        const edited = await this.updateLiveMessage(text, photo);
        if (!edited) this.liveMessageId = await this.sendNew(text, photo, urgent, true);
        return;
      }

      if (event.type === 'print_started') {
        // Reconnexion à une impression déjà en cours : pas de nouveau message.
        if (event.resumed) {
          log.info('Skipping print_started — reconnected to active print');
          return;
        }
        this.liveMessageId = await this.sendNew(text, photo, urgent, true);
        return;
      }

      if (event.type === 'print_completed' || event.type === 'print_failed') {
        await this.sendNew(text, photo, urgent, false);
        this.liveMessageId = null;
        return;
      }

      await this.sendNew(text, photo, urgent, withButtons);
    } catch (err) {
      log.error(`Failed: ${(err as Error).message}`);
    }
  }

  private async sendNew(
    text: string,
    photo: Buffer | null,
    urgent: boolean,
    buttons: boolean,
  ): Promise<number | null> {
    const chatId = this.config.telegramChatId;
    const caption = safeCaption(text);
    const reply_markup = buttons ? this.keyboard() : undefined;
    if (photo) {
      const msg = await this.bot.api.sendPhoto(
        chatId,
        new InputFile(photo, `snapshot_${Date.now()}.jpg`),
        {
          caption,
          parse_mode: 'MarkdownV2',
          disable_notification: !urgent,
          reply_markup,
        },
      );
      log.info(`Sent new photo message ${msg.message_id}`);
      return msg.message_id;
    }
    const msg = await this.bot.api.sendMessage(chatId, caption, {
      parse_mode: 'MarkdownV2',
      disable_notification: !urgent,
      reply_markup,
    });
    log.info(`Sent new text message ${msg.message_id}`);
    return msg.message_id;
  }

  private async updateLiveMessage(text: string, photo: Buffer | null): Promise<boolean> {
    if (!this.liveMessageId) return false;
    const chatId = this.config.telegramChatId;
    const caption = safeCaption(text);
    try {
      if (photo) {
        const media = InputMediaBuilder.photo(new InputFile(photo, `snapshot_${Date.now()}.jpg`), {
          caption,
          parse_mode: 'MarkdownV2',
        });
        await this.bot.api.editMessageMedia(chatId, this.liveMessageId, media, {
          reply_markup: this.keyboard(),
        });
      } else {
        await this.bot.api.editMessageCaption(chatId, this.liveMessageId, {
          caption,
          parse_mode: 'MarkdownV2',
          reply_markup: this.keyboard(),
        });
      }
      log.info(`Updated live message ${this.liveMessageId}`);
      return true;
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('message is not modified')) return true;
      log.warn(`Edit failed (msgId=${this.liveMessageId}): ${msg}`);
      // Message supprimé côté Telegram : un nouveau sera envoyé.
      this.liveMessageId = null;
      return false;
    }
  }

  get isRunning(): boolean {
    return this._running;
  }

  async start(): Promise<void> {
    log.info('Starting bot...');
    await this.bot.api
      .setMyCommands([
        { command: 'status', description: 'État et photo' },
        { command: 'photo', description: 'Photo de la caméra' },
        { command: 'pause', description: "Mettre l'impression en pause" },
        { command: 'resume', description: "Reprendre l'impression" },
      ])
      .catch((err) => log.warn(`setMyCommands: ${(err as Error).message}`));
    this.bot.start({
      onStart: () => {
        this._running = true;
        log.info('Bot is running ✓');
      },
    });
  }

  /** Alerte IA avec photo et bouton de pause immédiat. */
  async sendAIAlert(alert: AIAlert): Promise<void> {
    const icon = alert.status === 'critical' ? '🚨' : '⚠️';
    // Type et confiance seulement : les descriptions CLIP dépassent la limite de légende.
    const issueLines = alert.issues
      .map(
        (i) =>
          `${icon} ${esc(ISSUE_FR[i.type] ?? i.type)} \\(${Math.round(i.confidence * 100)} %\\)`,
      )
      .join('\n');
    const text = [
      '🤖 *Alerte IA*',
      issueLines || `${icon} ${esc(alert.description.slice(0, 80))}`,
      `\n_${esc(`${alert.consecutiveWarnings} détections consécutives`)}_`,
    ].join('\n');

    try {
      const photo = this.config.cameraEnabled ? await getSnapshot(this.config) : null;
      await this.sendNew(text, photo, true, true);
    } catch (err) {
      log.error(`AI alert failed: ${(err as Error).message}`);
    }
  }

  stop(): void {
    this._running = false;
    this.bot.stop();
  }
}
