import type { AppConfig } from "./config.js";
import type { TrendingToken } from "./gmgn-client.js";

export type FastGrowthAlert = {
  token: TrendingToken;
  score: number;
  reasons: string[];
};

type TokenSnapshot = {
  volumeUsd: number;
  rank: number;
  hotLevel: number;
  seenAt: number;
};

export class FastGrowthDetector {
  private readonly snapshots = new Map<string, TokenSnapshot>();
  private readonly lastAlertAt = new Map<string, number>();

  findAlerts(tokens: TrendingToken[], config: AppConfig, now = Date.now()): FastGrowthAlert[] {
    const alerts: FastGrowthAlert[] = [];

    for (const token of tokens) {
      const address = token.address;

      if (!address) {
        continue;
      }

      const previous = this.snapshots.get(address);
      const current = toSnapshot(token, now);
      const evaluation = evaluateToken(token, current, previous, config);

      this.snapshots.set(address, current);

      if (!evaluation.shouldAlert) {
        continue;
      }

      if (this.isCoolingDown(address, config.fastGrowth.alertCooldownMs, now)) {
        continue;
      }

      this.lastAlertAt.set(address, now);
      alerts.push({
        token,
        score: evaluation.score,
        reasons: evaluation.reasons,
      });
    }

    return alerts.sort((left, right) => right.score - left.score);
  }

  private isCoolingDown(address: string, cooldownMs: number, now: number): boolean {
    const lastAlertAt = this.lastAlertAt.get(address);
    return lastAlertAt !== undefined && now - lastAlertAt < cooldownMs;
  }
}

function evaluateToken(
  token: TrendingToken,
  current: TokenSnapshot,
  previous: TokenSnapshot | undefined,
  config: AppConfig,
): { shouldAlert: boolean; score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  if (isWashTrading(token.is_wash_trading)) {
    return { shouldAlert: false, score: 0, reasons: [] };
  }

  if (isAboveIfPresent(token.rug_ratio, config.fastGrowth.maxRugRatio)) {
    return { shouldAlert: false, score: 0, reasons: [] };
  }

  if (isAboveIfPresent(token.bundler_rate, config.fastGrowth.maxBundlerRate)) {
    return { shouldAlert: false, score: 0, reasons: [] };
  }

  if (isAboveIfPresent(token.rat_trader_amount_rate, config.fastGrowth.maxInsiderRate)) {
    return { shouldAlert: false, score: 0, reasons: [] };
  }

  const buySellRatio = ratio(toNumber(token.buys), toNumber(token.sells));
  const priceChange = Math.max(
    toNumber(token.price_change_percent),
    toNumber(token.price_change_percent1m),
    toNumber(token.price_change_percent5m),
    toNumber(token.price_change_percent1h),
  );

  if (current.volumeUsd >= config.fastGrowth.minVolumeUsd) {
    score += 30;
    reasons.push(`volume $${formatCompact(current.volumeUsd)}`);
  }

  if (current.hotLevel >= config.fastGrowth.minHotLevel) {
    score += 15;
    reasons.push(`hot level ${current.hotLevel}`);
  }

  if (toNumber(token.swaps) >= config.fastGrowth.minSwaps) {
    score += 15;
    reasons.push(`${toNumber(token.swaps)} swaps`);
  }

  if (priceChange >= config.fastGrowth.minPriceChangePercent) {
    score += 20;
    reasons.push(`price +${formatPercent(priceChange)}`);
  }

  if (buySellRatio >= config.fastGrowth.minBuySellRatio) {
    score += 10;
    reasons.push(`buy/sell ${buySellRatio.toFixed(2)}x`);
  }

  if (previous !== undefined) {
    const volumeMultiplier = ratio(current.volumeUsd, previous.volumeUsd);
    const rankImproved = previous.rank - current.rank;

    if (volumeMultiplier >= config.fastGrowth.volumeGrowthMultiplier) {
      score += 25;
      reasons.push(`volume ${volumeMultiplier.toFixed(2)}x vs last poll`);
    }

    if (rankImproved >= 5) {
      score += 10;
      reasons.push(`rank improved ${rankImproved}`);
    }
  }

  const passesBaseThreshold =
    current.volumeUsd >= config.fastGrowth.minVolumeUsd &&
    toNumber(token.swaps) >= config.fastGrowth.minSwaps &&
    toNumber(token.liquidity) >= config.fastGrowth.minLiquidityUsd;

  return {
    shouldAlert: passesBaseThreshold && score >= 60,
    score,
    reasons,
  };
}

function toSnapshot(token: TrendingToken, seenAt: number): TokenSnapshot {
  return {
    volumeUsd: toNumber(token.volume),
    rank: toNumber(token.rank),
    hotLevel: toNumber(token.hot_level),
    seenAt,
  };
}

export function formatFastGrowthAlert(alert: FastGrowthAlert): string {
  const token = alert.token;
  const symbol = token.symbol ?? "UNKNOWN";
  const name = token.name ? ` (${token.name})` : "";
  const address = token.address;

  return [
    "🚀 Fast growth alert",
    `${symbol}${name}`,
    `Address: ${address}`,
    `Platform: ${token.launchpad_platform ?? "unknown"}`,
    `Rank: ${token.rank ?? "n/a"} | Score: ${alert.score}`,
    `Volume: $${formatCompact(toNumber(token.volume))} | Swaps: ${toNumber(token.swaps)}`,
    `Liquidity: $${formatCompact(toNumber(token.liquidity))} | MCap: $${formatCompact(toNumber(token.market_cap))}`,
    `Reasons: ${alert.reasons.join(", ")}`,
    `GMGN: https://gmgn.ai/sol/token/${address}`,
  ].join("\n");
}

function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return numerator > 0 ? numerator : 0;
  }

  return numerator / denominator;
}

function isWashTrading(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function isAboveIfPresent(value: unknown, max: number): boolean {
  if (value === undefined || value === null || value === "") {
    return false;
  }

  return toNumber(value) > max;
}

function formatCompact(value: number): string {
  return Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}
