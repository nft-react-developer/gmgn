import type { AppConfig } from "./config.js";
import type { TelegramBotCommand, TelegramUpdate } from "./telegram-notifier.js";
import { TelegramNotifier } from "./telegram-notifier.js";
import {
  TokenPerformanceService,
  formatAnalysisMessage,
  parseTrackHours,
} from "./token-performance-service.js";
import { isTokenLabel } from "./token-performance-store.js";

export const TELEGRAM_BOT_COMMANDS: TelegramBotCommand[] = [
  { command: "status", description: "Show monitor status and active filters" },
  { command: "analyze", description: "Analyze a token address against current filters" },
  { command: "track", description: "Track a token performance window" },
  { command: "missed", description: "Save a missed token false negative" },
  { command: "label", description: "Label a token as good, bad, or noise" },
  { command: "review", description: "Review saved token performance data" },
  { command: "help", description: "Show available commands" },
];

export class TelegramCommandHandler {
  private nextUpdateId: number | undefined;

  constructor(
    private readonly telegram: TelegramNotifier,
    private readonly config: AppConfig,
    private readonly tokenPerformance: TokenPerformanceService,
  ) {}

  async discardPendingUpdates(): Promise<void> {
    const updates = await this.telegram.getUpdates();
    this.advanceOffset(updates);
  }

  async handlePendingCommands(): Promise<void> {
    const updates = await this.telegram.getUpdates(this.nextUpdateId);
    this.advanceOffset(updates);

    for (const update of updates) {
      const message = update.message;

      if (message?.text === undefined) {
        continue;
      }

      if (!this.isAllowedChat(message.chat.id)) {
        continue;
      }

      try {
        await this.handleAllowedCommand(message.text);
      } catch (error) {
        await this.telegram.sendMessage(`Command failed: ${formatError(error)}`);
      }
    }
  }

  private advanceOffset(updates: TelegramUpdate[]): void {
    for (const update of updates) {
      this.nextUpdateId = Math.max(this.nextUpdateId ?? 0, update.update_id + 1);
    }
  }

  private isAllowedChat(chatId: number | string): boolean {
    return String(chatId) === this.config.telegram.chatId;
  }

  private async handleAllowedCommand(text: string): Promise<void> {
    if (!text.startsWith("/")) {
      return;
    }

    const parts = text.trim().split(/\s+/);
    const command = parts[0]?.split("@")[0]?.toLowerCase();
    const args = parts.slice(1);

    if (command === "/status") {
      await this.telegram.sendMessage(buildStatusMessage(this.config));
      return;
    }

    if (command === "/analyze") {
      await this.handleAnalyze(args);
      return;
    }

    if (command === "/track") {
      await this.handleTrack(args);
      return;
    }

    if (command === "/missed") {
      await this.handleMissed(args);
      return;
    }

    if (command === "/label") {
      await this.handleLabel(args);
      return;
    }

    if (command === "/review") {
      await this.telegram.sendMessage(await this.tokenPerformance.formatReview());
      return;
    }

    if (command === "/help") {
      await this.telegram.sendMessage(buildHelpMessage());
    }
  }

  private async handleAnalyze(args: string[]): Promise<void> {
    const address = args[0];

    if (address === undefined) {
      await this.telegram.sendMessage("Usage: /analyze <token-address>");
      return;
    }

    const analysis = await this.tokenPerformance.analyze(address);
    await this.telegram.sendMessage(formatAnalysisMessage("🔎 Token analysis", analysis));
  }

  private async handleTrack(args: string[]): Promise<void> {
    const address = args[0];

    if (address === undefined) {
      await this.telegram.sendMessage("Usage: /track <token-address> [hours]");
      return;
    }

    const hours = parseTrackHours(args[1], this.config.analytics.defaultTrackHours);
    const analysis = await this.tokenPerformance.track(address, hours);
    await this.telegram.sendMessage(
      [
        `Tracking ${shortAddress(address)} for ${hours}h.`,
        `Data will be saved in ${this.config.analytics.storePath}.`,
        "",
        formatAnalysisMessage("Initial analysis", analysis),
      ].join("\n"),
    );
  }

  private async handleMissed(args: string[]): Promise<void> {
    const address = args[0];

    if (address === undefined) {
      await this.telegram.sendMessage("Usage: /missed <token-address>");
      return;
    }

    const analysis = await this.tokenPerformance.markMissed(address);
    await this.telegram.sendMessage(formatAnalysisMessage("📌 Missed token saved", analysis));
  }

  private async handleLabel(args: string[]): Promise<void> {
    const address = args[0];
    const label = args[1];

    if (address === undefined || !isTokenLabel(label)) {
      await this.telegram.sendMessage("Usage: /label <token-address> good|bad|noise");
      return;
    }

    await this.tokenPerformance.label(address, label);
    await this.telegram.sendMessage(`Saved label ${label} for ${shortAddress(address)}.`);
  }
}

function buildStatusMessage(config: AppConfig): string {
  return [
    "GMGN monitor status: running",
    `Trending: ${config.trending.chain} ${config.trending.interval} ${config.trending.launchpadPlatforms.join(", ")}`,
    `Poll interval: ${config.monitor.pollIntervalMs}ms`,
    `Min volume: $${config.fastGrowth.minVolumeUsd}`,
    `Min swaps: ${config.fastGrowth.minSwaps}`,
    `Analytics store: ${config.analytics.storePath}`,
  ].join("\n");
}

function buildHelpMessage(): string {
  return [
    "Available commands:",
    ...TELEGRAM_BOT_COMMANDS.map((command) => `/${command.command} - ${command.description}`),
  ].join("\n");
}

function shortAddress(address: string): string {
  if (address.length <= 12) {
    return address;
  }

  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
