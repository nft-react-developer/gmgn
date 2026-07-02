import type { AppConfig } from "./config.js";
import type { TrendingToken } from "./gmgn-client.js";

type ScoreBucket = {
  score: number;
  reasons: string[];
};

export type TraderScoreBreakdown = {
  momentum: ScoreBucket;
  liquidity: ScoreBucket;
  holderRisk: ScoreBucket;
  manipulation: ScoreBucket;
};

export type FastGrowthAlert = {
  token: TrendingToken;
  score: number;
  breakdown: TraderScoreBreakdown;
  reasons: string[];
};

export type TokenScanDiagnostic = {
  token: TrendingToken;
  score: number;
  breakdown: TraderScoreBreakdown;
  reasons: string[];
  rejectionReasons: string[];
  isNewToken: boolean;
};

export type FastGrowthScan = {
  alerts: FastGrowthAlert[];
  diagnostics: {
    scannedTokens: number;
    newTokens: TokenScanDiagnostic[];
    blockedByManipulation: TokenScanDiagnostic[];
    rejectedByThreshold: TokenScanDiagnostic[];
    coolingDown: TokenScanDiagnostic[];
    topCandidates: TokenScanDiagnostic[];
  };
};

export type TokenSnapshot = {
  volumeUsd: number;
  rank: number;
  hotLevel: number;
  seenAt: number;
};

type TokenEvaluation = {
  shouldAlert: boolean;
  score: number;
  breakdown: TraderScoreBreakdown;
  reasons: string[];
  rejectionReasons: string[];
};

export class FastGrowthDetector {
  private readonly snapshots = new Map<string, TokenSnapshot>();
  private readonly lastAlertAt = new Map<string, number>();

  findAlerts(tokens: TrendingToken[], config: AppConfig, now = Date.now()): FastGrowthAlert[] {
    return this.scanTokens(tokens, config, now).alerts;
  }

  scanTokens(tokens: TrendingToken[], config: AppConfig, now = Date.now()): FastGrowthScan {
    const alerts: FastGrowthAlert[] = [];
    const newTokens: TokenScanDiagnostic[] = [];
    const blockedByManipulation: TokenScanDiagnostic[] = [];
    const rejectedByThreshold: TokenScanDiagnostic[] = [];
    const coolingDown: TokenScanDiagnostic[] = [];
    const evaluatedTokens: TokenScanDiagnostic[] = [];

    for (const token of tokens) {
      const address = token.address;

      if (!address) {
        continue;
      }

      const previous = this.snapshots.get(address);
      const current = toSnapshot(token, now);
      const diagnostic = analyzeFastGrowthToken(token, config, previous, now);

      this.snapshots.set(address, current);
      evaluatedTokens.push(diagnostic);

      if (diagnostic.isNewToken) {
        newTokens.push(diagnostic);
      }

      if (diagnostic.rejectionReasons.length > 0) {
        if (diagnostic.rejectionReasons.some((reason) => reason.startsWith("manipulation:"))) {
          blockedByManipulation.push(diagnostic);
        } else {
          rejectedByThreshold.push(diagnostic);
        }

        continue;
      }

      if (this.isCoolingDown(address, config.fastGrowth.alertCooldownMs, now)) {
        coolingDown.push(diagnostic);
        continue;
      }

      this.lastAlertAt.set(address, now);
      alerts.push({
        token,
        score: diagnostic.score,
        breakdown: diagnostic.breakdown,
        reasons: diagnostic.reasons,
      });
    }

    return {
      alerts: alerts.sort((left, right) => right.score - left.score),
      diagnostics: {
        scannedTokens: evaluatedTokens.length,
        newTokens: newTokens.sort(byScoreDesc),
        blockedByManipulation: blockedByManipulation.sort(byScoreDesc),
        rejectedByThreshold: rejectedByThreshold.sort(byScoreDesc),
        coolingDown: coolingDown.sort(byScoreDesc),
        topCandidates: evaluatedTokens.sort(byScoreDesc).slice(0, 5),
      },
    };
  }

  private isCoolingDown(address: string, cooldownMs: number, now: number): boolean {
    const lastAlertAt = this.lastAlertAt.get(address);
    return lastAlertAt !== undefined && now - lastAlertAt < cooldownMs;
  }
}

export function analyzeFastGrowthToken(
  token: TrendingToken,
  config: AppConfig,
  previous: TokenSnapshot | undefined,
  now = Date.now(),
): TokenScanDiagnostic {
  const current = toSnapshot(token, now);
  const evaluation = evaluateToken(token, current, previous, config);

  return {
    token,
    score: evaluation.score,
    breakdown: evaluation.breakdown,
    reasons: evaluation.reasons,
    rejectionReasons: evaluation.rejectionReasons,
    isNewToken: previous === undefined,
  };
}

export function snapshotTrendingToken(token: TrendingToken, seenAt = Date.now()): TokenSnapshot {
  return toSnapshot(token, seenAt);
}

function evaluateToken(
  token: TrendingToken,
  current: TokenSnapshot,
  previous: TokenSnapshot | undefined,
  config: AppConfig,
): TokenEvaluation {
  const manipulation = scoreManipulation(token, config);
  const momentum = scoreMomentum(token, current, previous, config);
  const liquidity = scoreLiquidity(token, current, config);
  const holderRisk = scoreHolderRisk(token, config);

  const breakdown: TraderScoreBreakdown = {
    momentum,
    liquidity,
    holderRisk,
    manipulation: manipulation.bucket,
  };
  const score = sumBuckets(breakdown);
  const reasons = formatReasons(breakdown);

  const passesBaseThreshold =
    current.volumeUsd >= config.fastGrowth.minVolumeUsd &&
    toNumber(token.swaps) >= config.fastGrowth.minSwaps &&
    toNumber(token.liquidity) >= config.fastGrowth.minLiquidityUsd;
  const rejectionReasons = getRejectionReasons(
    manipulation.blockReasons,
    passesBaseThreshold,
    score,
    config,
  );

  return {
    shouldAlert: rejectionReasons.length === 0,
    score,
    breakdown,
    reasons,
    rejectionReasons,
  };
}

function scoreMomentum(
  token: TrendingToken,
  current: TokenSnapshot,
  previous: TokenSnapshot | undefined,
  config: AppConfig,
): ScoreBucket {
  const bucket: ScoreBucket = { score: 0, reasons: [] };
  const buySellRatio = ratio(toNumber(token.buys), toNumber(token.sells));
  const priceChange = Math.max(
    toNumber(token.price_change_percent),
    toNumber(token.price_change_percent1m),
    toNumber(token.price_change_percent5m),
    toNumber(token.price_change_percent1h),
  );

  if (current.hotLevel >= config.fastGrowth.minHotLevel) {
    addScore(bucket, 15, `hot level ${current.hotLevel}`);
  }

  if (priceChange >= config.fastGrowth.minPriceChangePercent) {
    addScore(bucket, 20, `price +${formatPercent(priceChange)}`);
  }

  if (buySellRatio >= config.fastGrowth.minBuySellRatio) {
    addScore(bucket, 10, `buy/sell ${buySellRatio.toFixed(2)}x`);
  }

  if (previous !== undefined) {
    const volumeMultiplier = ratio(current.volumeUsd, previous.volumeUsd);
    const rankImproved = previous.rank - current.rank;

    if (volumeMultiplier >= config.fastGrowth.volumeGrowthMultiplier) {
      addScore(bucket, 25, `volume ${volumeMultiplier.toFixed(2)}x vs last poll`);
    }

    if (rankImproved >= 5) {
      addScore(bucket, 10, `rank improved ${rankImproved}`);
    }
  }

  return bucket;
}

function scoreLiquidity(token: TrendingToken, current: TokenSnapshot, config: AppConfig): ScoreBucket {
  const bucket: ScoreBucket = { score: 0, reasons: [] };
  const swaps = toNumber(token.swaps);
  const liquidityUsd = toNumber(token.liquidity);

  if (config.fastGrowth.minVolumeUsd > 0 && current.volumeUsd >= config.fastGrowth.minVolumeUsd) {
    addScore(bucket, 25, `volume $${formatCompact(current.volumeUsd)}`);
  }

  if (config.fastGrowth.minSwaps > 0 && swaps >= config.fastGrowth.minSwaps) {
    addScore(bucket, 10, `${swaps} swaps`);
  }

  if (config.fastGrowth.minLiquidityUsd > 0 && liquidityUsd >= config.fastGrowth.minLiquidityUsd) {
    addScore(bucket, 10, `liquidity $${formatCompact(liquidityUsd)}`);
  }

  return bucket;
}

function scoreHolderRisk(token: TrendingToken, config: AppConfig): ScoreBucket {
  const bucket: ScoreBucket = { score: 0, reasons: [] };
  const holderCount = toNumber(token.holder_count);
  const top10HolderRate = toNumber(token.top_10_holder_rate);
  const smartDegenCount = toNumber(token.smart_degen_count);
  const renownedCount = toNumber(token.renowned_count);

  if (config.fastGrowth.minHolderCount > 0 && holderCount >= config.fastGrowth.minHolderCount) {
    addScore(bucket, 8, `${holderCount} holders`);
  }

  if (isPresent(token.top_10_holder_rate) && top10HolderRate <= config.fastGrowth.maxTop10HolderRate) {
    addScore(bucket, 8, `top 10 holders ${formatRate(top10HolderRate)}`);
  }

  if (
    config.fastGrowth.minSmartDegenCount > 0 &&
    smartDegenCount >= config.fastGrowth.minSmartDegenCount
  ) {
    addScore(bucket, 4, `${smartDegenCount} smart degens`);
  }

  if (config.fastGrowth.minRenownedCount > 0 && renownedCount >= config.fastGrowth.minRenownedCount) {
    addScore(bucket, 4, `${renownedCount} renowned wallets`);
  }

  return bucket;
}

function scoreManipulation(
  token: TrendingToken,
  config: AppConfig,
): { bucket: ScoreBucket; blocked: boolean; blockReasons: string[] } {
  const blockReasons: string[] = [];

  if (isWashTrading(token.is_wash_trading)) {
    blockReasons.push("wash trading");
  }

  if (isAboveIfPresent(token.rug_ratio, config.fastGrowth.maxRugRatio)) {
    blockReasons.push(`rug ratio > ${formatRate(config.fastGrowth.maxRugRatio)}`);
  }

  if (isAboveIfPresent(token.bundler_rate, config.fastGrowth.maxBundlerRate)) {
    blockReasons.push(`bundler rate > ${formatRate(config.fastGrowth.maxBundlerRate)}`);
  }

  if (isAboveIfPresent(token.rat_trader_amount_rate, config.fastGrowth.maxInsiderRate)) {
    blockReasons.push(`insider rate > ${formatRate(config.fastGrowth.maxInsiderRate)}`);
  }

  if (blockReasons.length > 0) {
    return {
      blocked: true,
      blockReasons,
      bucket: {
        score: 0,
        reasons: blockReasons.map((reason) => `blocked: ${reason}`),
      },
    };
  }

  return {
    blocked: false,
    blockReasons,
    bucket: {
      score: 15,
      reasons: ["manipulation filters clean"],
    },
  };
}

function getRejectionReasons(
  manipulationBlockReasons: string[],
  passesBaseThreshold: boolean,
  score: number,
  config: AppConfig,
): string[] {
  const rejectionReasons: string[] = [];

  for (const reason of manipulationBlockReasons) {
    rejectionReasons.push(`manipulation: ${reason}`);
  }

  if (!passesBaseThreshold) {
    rejectionReasons.push(
      `base threshold: needs volume >= ${config.fastGrowth.minVolumeUsd}, swaps >= ${config.fastGrowth.minSwaps}, liquidity >= ${config.fastGrowth.minLiquidityUsd}`,
    );
  }

  if (score < config.fastGrowth.minTraderScore) {
    rejectionReasons.push(`score: ${score} < ${config.fastGrowth.minTraderScore}`);
  }

  return rejectionReasons;
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
    `Platform: ${formatLaunchpadPlatforms(token.launchpad_platform)}`,
    `Rank: ${token.rank ?? "n/a"} | Score: ${alert.score}`,
    formatBreakdown(alert.breakdown),
    `Volume: $${formatCompact(toNumber(token.volume))} | Swaps: ${toNumber(token.swaps)}`,
    `Liquidity: $${formatCompact(toNumber(token.liquidity))} | MCap: $${formatCompact(toNumber(token.market_cap))}`,
    `Reasons: ${alert.reasons.join(", ")}`,
    `GMGN: https://gmgn.ai/sol/token/${address}`,
  ].join("\n");
}

function addScore(bucket: ScoreBucket, score: number, reason: string): void {
  bucket.score += score;
  bucket.reasons.push(reason);
}

function sumBuckets(breakdown: TraderScoreBreakdown): number {
  return (
    breakdown.momentum.score +
    breakdown.liquidity.score +
    breakdown.holderRisk.score +
    breakdown.manipulation.score
  );
}

function formatReasons(breakdown: TraderScoreBreakdown): string[] {
  return [
    ...formatBucketReasons("momentum", breakdown.momentum),
    ...formatBucketReasons("liquidity", breakdown.liquidity),
    ...formatBucketReasons("holders/risk", breakdown.holderRisk),
    ...formatBucketReasons("manipulation", breakdown.manipulation),
  ];
}

function formatBucketReasons(label: string, bucket: ScoreBucket): string[] {
  return bucket.reasons.map((reason) => `${label}: ${reason}`);
}

function formatBreakdown(breakdown: TraderScoreBreakdown): string {
  return [
    "Breakdown:",
    `Momentum ${breakdown.momentum.score}`,
    `Liquidity ${breakdown.liquidity.score}`,
    `Holders/Risk ${breakdown.holderRisk.score}`,
    `Manipulation ${breakdown.manipulation.score}`,
  ].join(" | ");
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

function formatLaunchpadPlatforms(value: string | string[] | undefined): string {
  if (value === undefined) {
    return "unknown";
  }

  return Array.isArray(value) ? value.join(", ") : value;
}

function isAboveIfPresent(value: unknown, max: number): boolean {
  if (!isPresent(value)) {
    return false;
  }

  return toNumber(value) > max;
}

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
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

function formatRate(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function byScoreDesc(left: TokenScanDiagnostic, right: TokenScanDiagnostic): number {
  return right.score - left.score;
}
