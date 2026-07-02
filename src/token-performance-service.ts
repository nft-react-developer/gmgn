import type { AppConfig } from "./config.js";
import { analyzeFastGrowthToken, snapshotTrendingToken } from "./fast-growth-alert.js";
import { GmgnClient } from "./gmgn-client.js";
import {
  TokenPerformanceStore,
  type AnalysisSource,
  type StoredAnalysis,
  type TokenLabel,
  toStoredAnalysis,
} from "./token-performance-store.js";

export class TokenPerformanceService {
  constructor(
    private readonly gmgn: GmgnClient,
    private readonly config: AppConfig,
    private readonly store: TokenPerformanceStore,
  ) {}

  async analyze(address: string, source: AnalysisSource = "analyze-command"): Promise<StoredAnalysis> {
    const analysis = await this.buildAnalysis(address, source);
    await this.store.recordTrackedAnalysis(address, analysis);
    return analysis;
  }

  async track(address: string, hours = this.config.analytics.defaultTrackHours): Promise<StoredAnalysis> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + hours * 60 * 60 * 1_000);
    const analysis = await this.buildAnalysis(address, "track-command");

    await this.store.addTrackedToken(address, this.config.trending.chain, expiresAt, analysis);
    return analysis;
  }

  async markMissed(address: string): Promise<StoredAnalysis> {
    const analysis = await this.buildAnalysis(address, "missed-command");
    await this.store.recordMissedToken(address, this.config.trending.chain, analysis);
    return analysis;
  }

  async label(address: string, label: TokenLabel): Promise<void> {
    await this.store.setLabel(address, label);
  }

  async refreshTrackedTokens(): Promise<{ refreshed: number; failed: number }> {
    const trackedTokens = await this.store.getActiveTrackedTokens();
    let refreshed = 0;
    let failed = 0;

    for (const trackedToken of trackedTokens) {
      try {
        await this.analyze(trackedToken.address, "track-poll");
        refreshed += 1;
      } catch (error) {
        failed += 1;
        console.warn(`[performance] failed to refresh ${shortAddress(trackedToken.address)}: ${formatError(error)}`);
      }
    }

    return { refreshed, failed };
  }

  private async buildAnalysis(address: string, source: AnalysisSource): Promise<StoredAnalysis> {
    const now = new Date();
    const token = await this.gmgn.getTokenProfile(this.config.trending.chain, address, this.config.trending.interval);
    const previous = await this.store.getPreviousSnapshot(address);
    const diagnostic = analyzeFastGrowthToken(token, this.config, previous, now.getTime());
    const snapshot = snapshotTrendingToken(token, now.getTime());

    return toStoredAnalysis(token, diagnostic, snapshot, source, now);
  }

  async formatReview(): Promise<string> {
    const data = await this.store.readSummary();
    const now = Date.now();
    const activeTracked = Object.values(data.trackedTokens).filter((token) => new Date(token.expiresAt).getTime() > now);
    const rejectionCounts = new Map<string, number>();

    for (const analysis of data.analyses) {
      for (const reason of analysis.rejectionReasons) {
        rejectionCounts.set(reason, (rejectionCounts.get(reason) ?? 0) + 1);
      }
    }

    const topRejections = [...rejectionCounts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([reason, count]) => `- ${reason}: ${count}`)
      .join("\n");

    const labels = Object.values(data.labels).reduce<Record<TokenLabel, number>>(
      (acc, label) => {
        acc[label] += 1;
        return acc;
      },
      { good: 0, bad: 0, noise: 0 },
    );

    return [
      "📊 Token performance review",
      `Tracked active: ${activeTracked.length}`,
      `Missed marked: ${data.missedTokens.length}`,
      `Analyses saved: ${data.analyses.length}`,
      `Labels: good=${labels.good}, bad=${labels.bad}, noise=${labels.noise}`,
      "",
      "Top rejection reasons:",
      topRejections || "- none yet",
      "",
      `Store: ${this.config.analytics.storePath}`,
    ].join("\n");
  }
}

export function formatAnalysisMessage(title: string, analysis: StoredAnalysis): string {
  const token = analysis.token;

  return [
    title,
    `${token.symbol ?? "UNKNOWN"}${token.name === undefined ? "" : ` (${token.name})`}`,
    `Address: ${token.address}`,
    `Platform: ${token.platform ?? "unknown"}`,
    `Score: ${analysis.score} | Would alert: ${analysis.wouldAlert ? "yes" : "no"}`,
    formatStoredBreakdown(analysis),
    `Volume: $${formatCompact(toNumber(token.volume))} | Swaps: ${toNumber(token.swaps)}`,
    `Liquidity: $${formatCompact(toNumber(token.liquidity))} | MCap: $${formatCompact(toNumber(token.marketCap))}`,
    `Rejected by: ${analysis.rejectionReasons.join(", ") || "none"}`,
    `Reasons: ${analysis.reasons.slice(0, 8).join(", ") || "none"}`,
    `GMGN: https://gmgn.ai/sol/token/${token.address}`,
  ].join("\n");
}

export function parseTrackHours(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function formatStoredBreakdown(analysis: StoredAnalysis): string {
  return [
    "Breakdown:",
    `Momentum ${analysis.breakdown.momentum.score}`,
    `Liquidity ${analysis.breakdown.liquidity.score}`,
    `Holders/Risk ${analysis.breakdown.holderRisk.score}`,
    `Manipulation ${analysis.breakdown.manipulation.score}`,
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

function formatCompact(value: number): string {
  return Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
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
