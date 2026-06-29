import type { AppConfig } from "./config.js";
import { FastGrowthDetector, formatFastGrowthAlert } from "./fast-growth-alert.js";
import { GmgnClient, type TrendingToken } from "./gmgn-client.js";
import { TelegramNotifier } from "./telegram-notifier.js";

export async function startMonitor(config: AppConfig): Promise<void> {
  const gmgn = new GmgnClient(config.gmgn.apiKey, config.gmgn.baseUrl);
  const telegram = new TelegramNotifier(
    config.telegram.botToken,
    config.telegram.chatId,
    config.telegram.apiBaseUrl,
  );
  const fastGrowthDetector = new FastGrowthDetector();

  await telegram.sendMessage(buildStartupMessage(config));

  await runLoop(config, async () => {
    await collectMonitoringSnapshot(gmgn, telegram, fastGrowthDetector, config);
  });
}

async function runLoop(config: AppConfig, task: () => Promise<void>): Promise<never> {
  for (;;) {
    try {
      await task();
    } catch (error) {
      console.error(formatRuntimeError(error));
    }

    await sleep(config.monitor.pollIntervalMs);
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
    platforms: config.trending.platforms,
    minVolumeUsd: config.fastGrowth.minVolumeUsd,
    minSwaps: config.fastGrowth.minSwaps,
    minLiquidityUsd: config.fastGrowth.minLiquidityUsd,
    maxRugRatio: config.fastGrowth.maxRugRatio,
    maxBundlerRate: config.fastGrowth.maxBundlerRate,
    maxInsiderRate: config.fastGrowth.maxInsiderRate,
  });

  const filteredTokens = filterWatchedTokens(tokens, config.monitor.watchedTokenAddresses);
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
    `Watched tokens: ${watchedCount}.`,
    `Trending: ${config.trending.chain} ${config.trending.interval} ${config.trending.platforms.join(", ")}.`,
    `Fast growth: min volume $${config.fastGrowth.minVolumeUsd}, min swaps ${config.fastGrowth.minSwaps}.`,
  ].join("\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatRuntimeError(error: unknown): string {
  if (error instanceof Error) {
    return `[monitor] ${error.message}`;
  }

  return "[monitor] Unknown runtime error";
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
