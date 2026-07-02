import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { TokenScanDiagnostic, TokenSnapshot, TraderScoreBreakdown } from "./fast-growth-alert.js";
import type { TrendingToken } from "./gmgn-client.js";

export type TokenLabel = "good" | "bad" | "noise";
export type AnalysisSource = "analyze-command" | "track-command" | "track-poll" | "missed-command";

export type StoredTokenMetrics = {
  address: string;
  symbol?: string;
  name?: string;
  platform?: string;
  rank?: string | number;
  price?: string | number;
  volume?: string | number;
  liquidity?: string | number;
  marketCap?: string | number;
  swaps?: string | number;
  holders?: string | number;
  rugRatio?: string | number;
  bundlerRate?: string | number;
  insiderRate?: string | number;
  top10HolderRate?: string | number;
};

export type StoredAnalysis = {
  observedAt: string;
  source: AnalysisSource;
  token: StoredTokenMetrics;
  score: number;
  wouldAlert: boolean;
  breakdown: TraderScoreBreakdown;
  reasons: string[];
  rejectionReasons: string[];
  snapshot: TokenSnapshot;
};

export type TrackedTokenRecord = {
  address: string;
  chain: string;
  addedAt: string;
  expiresAt: string;
  label?: TokenLabel;
  analyses: StoredAnalysis[];
};

export type MissedTokenRecord = {
  address: string;
  chain: string;
  markedAt: string;
  analysis?: StoredAnalysis;
};

export type PerformanceStoreData = {
  version: 1;
  trackedTokens: Record<string, TrackedTokenRecord>;
  missedTokens: MissedTokenRecord[];
  labels: Record<string, TokenLabel>;
  analyses: StoredAnalysis[];
};

const MAX_ANALYSES_PER_TOKEN = 120;
const MAX_GLOBAL_ANALYSES = 1_000;

export class TokenPerformanceStore {
  private pendingWrite: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  async addTrackedToken(address: string, chain: string, expiresAt: Date, analysis?: StoredAnalysis): Promise<void> {
    await this.update((data) => {
      const key = normalizeAddress(address);
      const existing = data.trackedTokens[key];
      const analyses = analysis === undefined ? existing?.analyses ?? [] : trimAnalyses([...(existing?.analyses ?? []), analysis]);

      data.trackedTokens[key] = {
        address,
        chain,
        addedAt: existing?.addedAt ?? new Date().toISOString(),
        expiresAt: expiresAt.toISOString(),
        ...(existing?.label === undefined ? {} : { label: existing.label }),
        analyses,
      };

      if (analysis !== undefined) {
        data.analyses = trimGlobalAnalyses([...data.analyses, analysis]);
      }
    });
  }

  async recordTrackedAnalysis(address: string, analysis: StoredAnalysis): Promise<void> {
    await this.update((data) => {
      const key = normalizeAddress(address);
      const tracked = data.trackedTokens[key];

      if (tracked === undefined) {
        data.analyses = trimGlobalAnalyses([...data.analyses, analysis]);
        return;
      }

      data.trackedTokens[key] = {
        ...tracked,
        analyses: trimAnalyses([...tracked.analyses, analysis]),
      };
      data.analyses = trimGlobalAnalyses([...data.analyses, analysis]);
    });
  }

  async recordMissedToken(address: string, chain: string, analysis?: StoredAnalysis): Promise<void> {
    await this.update((data) => {
      data.missedTokens.push({
        address,
        chain,
        markedAt: new Date().toISOString(),
        ...(analysis === undefined ? {} : { analysis }),
      });

      if (analysis !== undefined) {
        data.analyses = trimGlobalAnalyses([...data.analyses, analysis]);
      }
    });
  }

  async setLabel(address: string, label: TokenLabel): Promise<void> {
    await this.update((data) => {
      const key = normalizeAddress(address);
      data.labels[key] = label;

      const tracked = data.trackedTokens[key];
      if (tracked !== undefined) {
        data.trackedTokens[key] = { ...tracked, label };
      }
    });
  }

  async getPreviousSnapshot(address: string): Promise<TokenSnapshot | undefined> {
    const data = await this.readCurrent();
    const key = normalizeAddress(address);
    const tracked = data.trackedTokens[key];
    const latestTracked = tracked?.analyses.at(-1)?.snapshot;

    if (latestTracked !== undefined) {
      return latestTracked;
    }

    return [...data.analyses].reverse().find((analysis) => normalizeAddress(analysis.token.address) === key)?.snapshot;
  }

  async getActiveTrackedTokens(now = new Date()): Promise<TrackedTokenRecord[]> {
    const data = await this.readCurrent();
    return Object.values(data.trackedTokens).filter((token) => new Date(token.expiresAt).getTime() > now.getTime());
  }

  async readSummary(): Promise<PerformanceStoreData> {
    return this.readCurrent();
  }

  private async update(mutator: (data: PerformanceStoreData) => void): Promise<void> {
    const write = this.pendingWrite.then(async () => {
      const data = await this.read();
      mutator(data);
      await this.write(data);
    });

    this.pendingWrite = write.then(
      () => undefined,
      () => undefined,
    );
    await write;
  }

  private async readCurrent(): Promise<PerformanceStoreData> {
    await this.pendingWrite;
    return this.read();
  }

  private async read(): Promise<PerformanceStoreData> {
    try {
      const raw = await readFile(this.path, "utf8");
      return normalizeStore(JSON.parse(raw) as Partial<PerformanceStoreData>);
    } catch (error) {
      if (isMissingFile(error)) {
        return emptyStore();
      }

      throw error;
    }
  }

  private async write(data: PerformanceStoreData): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmpPath = `${this.path}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await rename(tmpPath, this.path);
  }
}

export function toStoredAnalysis(
  token: TrendingToken,
  diagnostic: TokenScanDiagnostic,
  snapshot: TokenSnapshot,
  source: AnalysisSource,
  observedAt: Date,
): StoredAnalysis {
  return {
    observedAt: observedAt.toISOString(),
    source,
    token: toStoredTokenMetrics(token),
    score: diagnostic.score,
    wouldAlert: diagnostic.rejectionReasons.length === 0,
    breakdown: diagnostic.breakdown,
    reasons: diagnostic.reasons,
    rejectionReasons: diagnostic.rejectionReasons,
    snapshot,
  };
}

export function isTokenLabel(value: string | undefined): value is TokenLabel {
  return value === "good" || value === "bad" || value === "noise";
}

function toStoredTokenMetrics(token: TrendingToken): StoredTokenMetrics {
  const metrics: StoredTokenMetrics = { address: token.address };
  addIfPresent(metrics, "symbol", token.symbol);
  addIfPresent(metrics, "name", token.name);
  addIfPresent(metrics, "platform", formatLaunchpadPlatforms(token.launchpad_platform));
  addIfPresent(metrics, "rank", token.rank);
  addIfPresent(metrics, "price", token.price);
  addIfPresent(metrics, "volume", token.volume);
  addIfPresent(metrics, "liquidity", token.liquidity);
  addIfPresent(metrics, "marketCap", token.market_cap);
  addIfPresent(metrics, "swaps", token.swaps);
  addIfPresent(metrics, "holders", token.holder_count);
  addIfPresent(metrics, "rugRatio", token.rug_ratio);
  addIfPresent(metrics, "bundlerRate", token.bundler_rate);
  addIfPresent(metrics, "insiderRate", token.rat_trader_amount_rate);
  addIfPresent(metrics, "top10HolderRate", token.top_10_holder_rate);

  return metrics;
}

function normalizeStore(data: Partial<PerformanceStoreData>): PerformanceStoreData {
  return {
    version: 1,
    trackedTokens: data.trackedTokens ?? {},
    missedTokens: data.missedTokens ?? [],
    labels: data.labels ?? {},
    analyses: data.analyses ?? [],
  };
}

function emptyStore(): PerformanceStoreData {
  return {
    version: 1,
    trackedTokens: {},
    missedTokens: [],
    labels: {},
    analyses: [],
  };
}

function trimAnalyses(analyses: StoredAnalysis[]): StoredAnalysis[] {
  return analyses.slice(-MAX_ANALYSES_PER_TOKEN);
}

function trimGlobalAnalyses(analyses: StoredAnalysis[]): StoredAnalysis[] {
  return analyses.slice(-MAX_GLOBAL_ANALYSES);
}

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

function formatLaunchpadPlatforms(value: string | string[] | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return Array.isArray(value) ? value.join(", ") : value;
}

function addIfPresent<TKey extends keyof StoredTokenMetrics>(
  metrics: StoredTokenMetrics,
  key: TKey,
  value: StoredTokenMetrics[TKey] | undefined,
): void {
  if (value !== undefined) {
    metrics[key] = value;
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
