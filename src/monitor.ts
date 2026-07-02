import type { AppConfig } from "./config.js";
import {
  FastGrowthDetector,
  type FastGrowthScan,
  type TraderScoreBreakdown,
  formatFastGrowthAlert,
} from "./fast-growth-alert.js";
import { GmgnClient, type TrendingToken } from "./gmgn-client.js";
import { TELEGRAM_BOT_COMMANDS, TelegramCommandHandler } from "./telegram-command-handler.js";
import { TelegramNotifier } from "./telegram-notifier.js";
import { TokenPerformanceService } from "./token-performance-service.js";
import { TokenPerformanceStore } from "./token-performance-store.js";

export async function startMonitor(config: AppConfig): Promise<void> {
  const gmgn = new GmgnClient(
    config.gmgn.apiKey,
    config.gmgn.baseUrl,
    config.retry,
    config.gmgn.marketSource,
    config.gmgn.cliCommand,
  );
  const telegram = new TelegramNotifier(
    config.telegram.botToken,
    config.telegram.chatId,
    config.telegram.apiBaseUrl,
    config.retry,
  );
  const fastGrowthDetector = new FastGrowthDetector();
  const tokenPerformance = new TokenPerformanceService(
    gmgn,
    config,
    new TokenPerformanceStore(config.analytics.storePath),
  );
  const telegramCommandHandler = new TelegramCommandHandler(telegram, config, tokenPerformance);

  await registerTelegramCommands(telegram);
  await telegram.sendMessage(buildStartupMessage(config));
  await telegramCommandHandler.discardPendingUpdates();

  await Promise.all([
    runLoop("telegram commands", config.monitor.commandPollIntervalMs, async () => {
      await telegramCommandHandler.handlePendingCommands();
    }),
    runLoop("gmgn market", config.monitor.pollIntervalMs, async () => {
      await collectMonitoringSnapshot(gmgn, telegram, fastGrowthDetector, tokenPerformance, config);
    }),
  ]);
}

async function registerTelegramCommands(telegram: TelegramNotifier): Promise<void> {
  try {
    await telegram.setMyCommands(TELEGRAM_BOT_COMMANDS);
  } catch (error) {
    console.warn(formatRuntimeError("telegram commands setup", error));
  }
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
  tokenPerformance: TokenPerformanceService,
  config: AppConfig,
): Promise<void> {
  const tokens = await gmgn.getTrendingRank({
    chain: config.trending.chain,
    interval: config.trending.interval,
    limit: config.trending.limit,
    orderBy: config.trending.orderBy,
    direction: config.trending.direction,
  });

  const sourceValidatedTokens = filterByLaunchpadSource(tokens, config);
  const filteredTokens = filterWatchedTokens(sourceValidatedTokens, config.monitor.watchedTokenAddresses);
  const scan = fastGrowthDetector.scanTokens(filteredTokens, config);

  logMonitoringSnapshot(tokens, sourceValidatedTokens, filteredTokens, scan, config);

  for (const alert of scan.alerts) {
    await telegram.sendMessage(formatFastGrowthAlert(alert));
  }

  const trackedRefresh = await tokenPerformance.refreshTrackedTokens();
  if (trackedRefresh.refreshed > 0 || trackedRefresh.failed > 0) {
    console.info(
      `[monitor:token performance] refreshed=${trackedRefresh.refreshed} failed=${trackedRefresh.failed}`,
    );
  }
}

function logMonitoringSnapshot(
  gmgnTokens: TrendingToken[],
  sourceValidatedTokens: TrendingToken[],
  filteredTokens: TrendingToken[],
  scan: FastGrowthScan,
  config: AppConfig,
): void {
  console.info(
    [
      "[monitor:gmgn market] snapshot",
      `source=${config.gmgn.marketSource}`,
      "server_filters=off",
      `gmgn=${gmgnTokens.length}`,
      `launchpad_kept=${sourceValidatedTokens.length}`,
      `watchlist_kept=${filteredTokens.length}`,
      `scored=${scan.diagnostics.scannedTokens}`,
      `new=${scan.diagnostics.newTokens.length}`,
      `alerts=${scan.alerts.length}`,
      `blocked=${scan.diagnostics.blockedByManipulation.length}`,
      `rejected=${scan.diagnostics.rejectedByThreshold.length}`,
      `cooldown=${scan.diagnostics.coolingDown.length}`,
    ].join(" "),
  );

  logTokenSamples("raw GMGN sample", gmgnTokens.slice(0, 5), formatTokenForLog);
  logTokenSamples("launchpad dropped", getDroppedTokens(gmgnTokens, sourceValidatedTokens).slice(0, 5), (token) =>
    `${formatTokenForLog(token)} reason=launchpad mismatch allowed=${config.trending.launchpadPlatforms.join(",")}`,
  );

  if (config.monitor.watchedTokenAddresses.length > 0) {
    logTokenSamples("watchlist dropped", getDroppedTokens(sourceValidatedTokens, filteredTokens).slice(0, 5), (token) =>
      `${formatTokenForLog(token)} reason=not in WATCHED_TOKEN_ADDRESSES`,
    );
  }

  logTokenSamples("new tokens after filters", scan.diagnostics.newTokens.slice(0, 5), (diagnostic) =>
    `${formatTokenForLog(diagnostic.token)} score=${diagnostic.score} reasons=${diagnostic.reasons.join("; ") || "none"}`,
  );
  logTokenSamples("blocked by manipulation", scan.diagnostics.blockedByManipulation.slice(0, 5), (diagnostic) =>
    `${formatTokenForLog(diagnostic.token)} score=${diagnostic.score} reject=${diagnostic.rejectionReasons.join("; ")}`,
  );
  logTokenSamples("rejected by thresholds", scan.diagnostics.rejectedByThreshold.slice(0, 5), (diagnostic) =>
    `${formatTokenForLog(diagnostic.token)} score=${diagnostic.score} reject=${diagnostic.rejectionReasons.join("; ")}`,
  );
  logTokenSamples("top scored candidates", scan.diagnostics.topCandidates.slice(0, 5), (diagnostic) =>
    `${formatTokenForLog(diagnostic.token)} score=${diagnostic.score} breakdown=${formatScoreBreakdown(diagnostic.breakdown)}`,
  );
}

function logTokenSamples<TValue>(
  label: string,
  values: TValue[],
  formatter: (value: TValue) => string,
): void {
  if (values.length === 0) {
    return;
  }

  console.info(`[monitor:gmgn market] ${label}: ${values.map(formatter).join(" | ")}`);
}

function getDroppedTokens(source: TrendingToken[], kept: TrendingToken[]): TrendingToken[] {
  const keptAddresses = new Set(kept.map((token) => token.address.toLowerCase()));
  return source.filter((token) => !keptAddresses.has(token.address.toLowerCase()));
}

function formatTokenForLog(token: TrendingToken): string {
  return [
    token.symbol ?? "UNKNOWN",
    shortAddress(token.address),
    `platform=${formatLaunchpadPlatforms(token.launchpad_platform)}`,
    `rank=${token.rank ?? "n/a"}`,
    `vol=${token.volume ?? "n/a"}`,
    `liq=${token.liquidity ?? "n/a"}`,
    `swaps=${token.swaps ?? "n/a"}`,
    `holders=${token.holder_count ?? "n/a"}`,
    `rug=${token.rug_ratio ?? "n/a"}`,
    `bundler=${token.bundler_rate ?? "n/a"}`,
    `insider=${token.rat_trader_amount_rate ?? "n/a"}`,
  ].join(" ");
}

function formatScoreBreakdown(breakdown: TraderScoreBreakdown): string {
  return [
    `momentum=${breakdown.momentum.score}`,
    `liquidity=${breakdown.liquidity.score}`,
    `holders=${breakdown.holderRisk.score}`,
    `manipulation=${breakdown.manipulation.score}`,
  ].join(",");
}

function shortAddress(address: string): string {
  if (address.length <= 12) {
    return address;
  }

  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function formatLaunchpadPlatforms(value: string | string[] | undefined): string {
  if (value === undefined) {
    return "unknown";
  }

  return Array.isArray(value) ? value.join(",") : value;
}

function buildStartupMessage(config: AppConfig): string {
  return [
    "GMGN Solana monitor started.",
    `Poll interval: ${config.monitor.pollIntervalMs}ms.`,
    `Command poll interval: ${config.monitor.commandPollIntervalMs}ms.`,
    formatWatchlistMode(config.monitor.watchedTokenAddresses),
    `Trending: ${config.trending.chain} ${config.trending.interval} ${config.trending.launchpadPlatforms.join(", ")}.`,
    `Launchpad validation: ${config.trending.requireLaunchpadMatch ? "enabled" : "disabled"}.`,
    `Fast growth: min volume $${config.fastGrowth.minVolumeUsd}, min swaps ${config.fastGrowth.minSwaps}.`,
    `Token analytics store: ${config.analytics.storePath}.`,
    "Commands: /status, /analyze, /track, /missed, /label, /review.",
  ].join("\n");
}

function formatWatchlistMode(watchedTokenAddresses: string[]): string {
  if (watchedTokenAddresses.length === 0) {
    return "Watchlist: disabled; scanning GMGN trending tokens.";
  }

  return `Watchlist: ${watchedTokenAddresses.length} token${watchedTokenAddresses.length === 1 ? "" : "s"}.`;
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
