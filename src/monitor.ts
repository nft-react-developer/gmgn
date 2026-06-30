import type { AppConfig } from "./config.js";
import { FastGrowthDetector, formatFastGrowthAlert } from "./fast-growth-alert.js";
import { GmgnClient, type TrendingToken } from "./gmgn-client.js";
import { TelegramCommandHandler } from "./telegram-command-handler.js";
import { TelegramNotifier } from "./telegram-notifier.js";

export async function startMonitor(config: AppConfig): Promise<void> {
  const gmgn = new GmgnClient(config.gmgn.apiKey, config.gmgn.baseUrl, config.retry);
  const telegram = new TelegramNotifier(
    config.telegram.botToken,
    config.telegram.chatId,
    config.telegram.apiBaseUrl,
    config.retry,
  );
  const fastGrowthDetector = new FastGrowthDetector();
  const telegramCommandHandler = new TelegramCommandHandler(telegram, config);

  await telegram.sendMessage(buildStartupMessage(config));
  await telegramCommandHandler.discardPendingUpdates();

  await Promise.all([
    runLoop("telegram commands", config.monitor.commandPollIntervalMs, async () => {
      await telegramCommandHandler.handlePendingCommands();
    }),
    runLoop("gmgn market", config.monitor.pollIntervalMs, async () => {
      await collectMonitoringSnapshot(gmgn, telegram, fastGrowthDetector, config);
    }),
  ]);
}

async function runLoop(name: string, intervalMs: number, task: () => Promise<void>): Promise<never> {
  for (;;) {
    try {
      await task();
    } catch (error) {
      console.error(formatRuntimeError(name, error));
    }

    await sleep(intervalMs);
  }
}

async function collectMonitoringSnapshot(
  gmgn: GmgnClient,
  telegram: TelegramNotifier,
  fastGrowthDetector: FastGrowthDetector,
  config: AppConfig,
): Promise<void> {
  const tokens = await gmgn.getTrendingRank({
    chain: config.trending.chain,
    interval: config.trending.interval,
    limit: config.trending.limit,
    orderBy: config.trending.orderBy,
    direction: config.trending.direction,
    launchpadPlatforms: config.trending.launchpadPlatforms,
    minVolumeUsd: config.fastGrowth.minVolumeUsd,
    minSwaps: config.fastGrowth.minSwaps,
    minLiquidityUsd: config.fastGrowth.minLiquidityUsd,
    maxRugRatio: config.fastGrowth.maxRugRatio,
    maxBundlerRate: config.fastGrowth.maxBundlerRate,
    maxInsiderRate: config.fastGrowth.maxInsiderRate,
  });

  const sourceValidatedTokens = filterByLaunchpadSource(tokens, config);
  const filteredTokens = filterWatchedTokens(sourceValidatedTokens, config.monitor.watchedTokenAddresses);
  const alerts = fastGrowthDetector.findAlerts(filteredTokens, config);

  for (const alert of alerts) {
    await telegram.sendMessage(formatFastGrowthAlert(alert));
  }
}

function buildStartupMessage(config: AppConfig): string {
  const watchedCount = config.monitor.watchedTokenAddresses.length;

  return [
    "GMGN Solana monitor started.",
    `Poll interval: ${config.monitor.pollIntervalMs}ms.`,
    `Command poll interval: ${config.monitor.commandPollIntervalMs}ms.`,
    `Watched tokens: ${watchedCount}.`,
    `Trending: ${config.trending.chain} ${config.trending.interval} ${config.trending.launchpadPlatforms.join(", ")}.`,
    `Launchpad validation: ${config.trending.requireLaunchpadMatch ? "enabled" : "disabled"}.`,
    `Fast growth: min volume $${config.fastGrowth.minVolumeUsd}, min swaps ${config.fastGrowth.minSwaps}.`,
    "Commands: /status.",
  ].join("\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatRuntimeError(loopName: string, error: unknown): string {
  if (error instanceof Error) {
    return `[monitor:${loopName}] ${error.message}`;
  }

  return `[monitor:${loopName}] Unknown runtime error`;
}

function filterWatchedTokens(
  tokens: TrendingToken[],
  watchedTokenAddresses: string[],
): TrendingToken[] {
  if (watchedTokenAddresses.length === 0) {
    return tokens;
  }

  const watched = new Set(watchedTokenAddresses.map((address) => address.toLowerCase()));
  return tokens.filter((token) => watched.has(token.address.toLowerCase()));
}

function filterByLaunchpadSource(tokens: TrendingToken[], config: AppConfig): TrendingToken[] {
  if (!config.trending.requireLaunchpadMatch) {
    return tokens;
  }

  const allowedPlatforms = new Set(
    config.trending.launchpadPlatforms.map((platform) => normalizeLaunchpadPlatform(platform)),
  );

  return tokens.filter((token) => {
    const launchpadPlatforms = normalizeLaunchpadPlatforms(token.launchpad_platform);

    if (launchpadPlatforms.some((launchpad) => allowedPlatforms.has(launchpad))) {
      return true;
    }

    if (!config.trending.addressSuffixFallback) {
      return false;
    }

    return token.address.toLowerCase().endsWith(config.trending.fallbackAddressSuffix.toLowerCase());
  });
}

function normalizeLaunchpadPlatforms(value: string | string[] | undefined): string[] {
  if (value === undefined) {
    return [];
  }

  const values = Array.isArray(value) ? value : [value];

  return values
    .map((platform) => normalizeLaunchpadPlatform(platform))
    .filter((platform) => platform.length > 0);
}

function normalizeLaunchpadPlatform(value: string): string {
  return value.trim().toLowerCase();
}
