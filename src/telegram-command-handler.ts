import type { AppConfig } from "./config.js";
import type { TelegramUpdate } from "./telegram-notifier.js";
import { TelegramNotifier } from "./telegram-notifier.js";

export class TelegramCommandHandler {
  private nextUpdateId: number | undefined;

  constructor(
    private readonly telegram: TelegramNotifier,
    private readonly config: AppConfig,
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

      await this.handleAllowedCommand(message.text);
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

    const command = text.split(/\s+/)[0]?.split("@")[0]?.toLowerCase();

    if (command === "/status") {
      await this.telegram.sendMessage(buildStatusMessage(this.config));
      return;
    }

    if (command === "/help") {
      await this.telegram.sendMessage("Available commands: /status");
    }
  }
}

function buildStatusMessage(config: AppConfig): string {
  return [
    "GMGN monitor status: running",
    `Trending: ${config.trending.chain} ${config.trending.interval} ${config.trending.launchpadPlatforms.join(", ")}`,
    `Poll interval: ${config.monitor.pollIntervalMs}ms`,
    `Min volume: $${config.fastGrowth.minVolumeUsd}`,
    `Min swaps: ${config.fastGrowth.minSwaps}`,
  ].join("\n");
}
