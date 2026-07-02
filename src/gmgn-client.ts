import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { HttpRequestError, type RetryPolicy, withRetry } from "./retry.js";

export type TrendingToken = {
  address: string;
  symbol?: string;
  name?: string;
  chain?: string;
  launchpad_platform?: string | string[];
  exchange?: string;
  rank?: number | string;
  hot_level?: number | string;
  price?: number | string;
  market_cap?: number | string;
  liquidity?: number | string;
  volume?: number | string;
  price_change_percent?: number | string;
  price_change_percent1m?: number | string;
  price_change_percent5m?: number | string;
  price_change_percent1h?: number | string;
  swaps?: number | string;
  buys?: number | string;
  sells?: number | string;
  holder_count?: number | string;
  rug_ratio?: number | string;
  is_wash_trading?: boolean | string | number;
  rat_trader_amount_rate?: number | string;
  bundler_rate?: number | string;
  top_10_holder_rate?: number | string;
  smart_degen_count?: number | string;
  renowned_count?: number | string;
  creation_timestamp?: number | string;
};

type GmgnEnvelope<TData> = {
  code: number | string;
  data?: TData;
  message?: string;
  error?: string;
};

type TrendingRankData = {
  rank?: TrendingToken[];
  list?: TrendingToken[];
  tokens?: TrendingToken[];
  items?: TrendingToken[];
  result?: TrendingToken[] | TrendingRankData;
  rows?: TrendingToken[];
  data?: TrendingToken[] | TrendingRankData;
};

type QueryParams = Record<string, string | string[]>;
type MarketSource = "cli" | "openapi";

const execFileAsync = promisify(execFile);

export class GmgnClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly retryPolicy: RetryPolicy,
    private readonly marketSource: MarketSource,
    private readonly cliCommand: string,
  ) {}

  async getJson<TResponse>(path: string, params: QueryParams = {}): Promise<TResponse> {
    const url = new URL(path, this.baseUrl);

    for (const [key, value] of Object.entries(params)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          url.searchParams.append(key, item);
        }
        continue;
      }

      url.searchParams.append(key, value);
    }

    const response = await withRetry(async () => {
      const result = await fetch(url, {
        method: "GET",
        headers: {
          "accept": "application/json",
          "content-type": "application/json",
          "X-APIKEY": this.apiKey,
        },
      });

      if (!result.ok) {
        throw new HttpRequestError("GMGN", result.status, `GET ${path}`);
      }

      return result;
    }, this.retryPolicy);

    return (await response.json()) as TResponse;
  }

  async getTrendingRank(params: {
    chain: string;
    interval: string;
    limit: number;
    orderBy: string;
    direction: string;
  }): Promise<TrendingToken[]> {
    if (this.marketSource === "cli") {
      return this.getTrendingRankFromCli(params);
    }

    return this.getTrendingRankFromOpenApi(params);
  }

  async getTokenProfile(chain: string, address: string, interval = "1m"): Promise<TrendingToken> {
    const [infoResult, securityResult] = await Promise.allSettled([
      this.getOpenApiData<unknown>("/v1/token/info", { chain, address }),
      this.getOpenApiData<unknown>("/v1/token/security", { chain, address }),
    ]);

    if (infoResult.status === "rejected" && securityResult.status === "rejected") {
      throw new Error(
        `GMGN token profile failed: ${formatErrorMessage(infoResult.reason)}; ${formatErrorMessage(securityResult.reason)}`,
      );
    }

    const info = infoResult.status === "fulfilled" ? normalizeTokenLike(infoResult.value, address, interval) : {};
    const security = securityResult.status === "fulfilled" ? normalizeTokenLike(securityResult.value, address, interval) : {};

    return {
      ...mergeDefined(info, security),
      address,
      chain,
    };
  }

  private async getTrendingRankFromOpenApi(params: {
    chain: string;
    interval: string;
    limit: number;
    orderBy: string;
    direction: string;
  }): Promise<TrendingToken[]> {
    const data = await this.getOpenApiData<TrendingRankData | TrendingToken[]>("/v1/market/rank", {
      chain: params.chain,
      interval: params.interval,
      limit: String(params.limit),
      order_by: params.orderBy,
      direction: params.direction,
    });

    const tokens = extractTrendingTokens(data);

    if (tokens.length === 0) {
      console.warn(`[gmgn] openapi trending returned 0 tokens. response_shape=${describeResponseShape(data)}`);
    }

    return tokens;
  }

  private async getTrendingRankFromCli(params: {
    chain: string;
    interval: string;
    limit: number;
    orderBy: string;
    direction: string;
  }): Promise<TrendingToken[]> {
    const args = [
      "market",
      "trending",
      "--chain",
      params.chain,
      "--interval",
      params.interval,
      "--limit",
      String(params.limit),
      "--order-by",
      params.orderBy,
      "--direction",
      params.direction,
      "--raw",
    ];

    try {
      const { stdout } = await execFileAsync(this.cliCommand, args, {
        encoding: "utf8",
        env: {
          ...process.env,
          GMGN_API_KEY: this.apiKey,
        },
        maxBuffer: 10 * 1024 * 1024,
      });
      const body = JSON.parse(stdout) as unknown;
      const tokens = extractTrendingTokens(body);

      if (tokens.length === 0) {
        console.warn(`[gmgn] cli trending returned 0 tokens. response_shape=${describeResponseShape(body)}`);
      }

      return tokens;
    } catch (error) {
      throw new Error(formatCliError(error, this.cliCommand));
    }
  }

  private async getOpenApiData<TData>(path: string, params: QueryParams): Promise<TData> {
    const envelope = await this.getJson<GmgnEnvelope<TData>>(path, {
      ...params,
      timestamp: String(Math.floor(Date.now() / 1000)),
      client_id: crypto.randomUUID(),
    });

    if (String(envelope.code) !== "0") {
      throw new Error(`GMGN OpenAPI error: ${envelope.error ?? envelope.message ?? envelope.code}`);
    }

    if (envelope.data === undefined) {
      throw new Error("GMGN OpenAPI response did not include data");
    }

    return envelope.data;
  }
}

function extractTrendingTokens(value: unknown): TrendingToken[] {
  if (Array.isArray(value)) {
    return value.flatMap(normalizeTrendingToken);
  }

  if (!isRecord(value)) {
    return [];
  }

  const directCandidates = [value.rank, value.list, value.tokens, value.items, value.result, value.rows];

  for (const candidate of directCandidates) {
    const tokens = extractTrendingTokens(candidate);

    if (tokens.length > 0) {
      return tokens;
    }
  }

  return extractTrendingTokens(value.data);
}

function normalizeTrendingToken(value: unknown): TrendingToken[] {
  return normalizeTrendingTokenLike(value);
}

function normalizeTokenLike(value: unknown, fallbackAddress: string, interval: string): TrendingToken {
  return normalizeTrendingTokenLike(value, fallbackAddress, interval)[0] ?? { address: fallbackAddress };
}

function normalizeTrendingTokenLike(value: unknown, fallbackAddress?: string, interval?: string): TrendingToken[] {
  if (!isRecord(value)) {
    return [];
  }

  if (isRecord(value.token)) {
    return normalizeTrendingTokenLike({
      ...value.token,
      ...value,
      token: undefined,
    }, fallbackAddress, interval);
  }

  const price = readRecord(value.price);
  const pool = readRecord(value.pool);
  const stat = readRecord(value.stat);
  const dev = readRecord(value.dev);
  const walletTagsStat = readRecord(value.wallet_tags_stat);
  const selectedInterval = interval ?? "1m";
  const currentPrice = readMetric(price, "price") ?? value.price;

  const address = readString(value.address) ??
    readString(value.token_address) ??
    readString(value.contract_address) ??
    readString(value.ca) ??
    fallbackAddress;

  if (address === undefined || address.length === 0) {
    return [];
  }

  return [{
    ...value,
    address,
    price: currentPrice,
    market_cap: readFirstMetric(value, [
      "market_cap",
      "marketcap",
      "usd_market_cap",
      "fdv",
      "mcap",
    ]) ?? calculateMarketCap(currentPrice, value.circulating_supply ?? value.total_supply),
    liquidity: readFirstMetric(value, ["liquidity", "liquidity_usd", "liquidityUsd"]) ?? readMetric(pool, "liquidity"),
    volume: readIntervalMetric(value, price, "volume", selectedInterval),
    swaps: readIntervalMetric(value, price, "swaps", selectedInterval),
    buys: readIntervalMetric(value, price, "buys", selectedInterval),
    sells: readIntervalMetric(value, price, "sells", selectedInterval),
    hot_level: value.hot_level ?? readMetric(price, "hot_level"),
    launchpad_platform: value.launchpad_platform ?? value.platform,
    price_change_percent: value.price_change_percent ??
      value.change ??
      calculatePriceChange(currentPrice, readMetric(price, `price_${selectedInterval}`)),
    price_change_percent1m: value.price_change_percent1m ?? value.change1m ?? calculatePriceChange(currentPrice, readMetric(price, "price_1m")),
    price_change_percent5m: value.price_change_percent5m ?? value.change5m ?? calculatePriceChange(currentPrice, readMetric(price, "price_5m")),
    price_change_percent1h: value.price_change_percent1h ?? value.change1h ?? calculatePriceChange(currentPrice, readMetric(price, "price_1h")),
    holder_count: value.holder_count ?? value.holders ?? readMetric(stat, "holder_count"),
    rat_trader_amount_rate: value.rat_trader_amount_rate ?? value.insider_rate ?? readMetric(stat, "top_rat_trader_percentage"),
    bundler_rate: value.bundler_rate ?? value.bundler_trader_amount_rate ?? readMetric(stat, "top_bundler_trader_percentage"),
    top_10_holder_rate: value.top_10_holder_rate ?? value.top10_holder_rate ?? readMetric(stat, "top_10_holder_rate") ?? readMetric(dev, "top_10_holder_rate"),
    smart_degen_count: value.smart_degen_count ?? readMetric(walletTagsStat, "smart_wallets"),
    renowned_count: value.renowned_count ?? readMetric(walletTagsStat, "renowned_wallets"),
  } as TrendingToken];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function readMetric(record: Record<string, unknown> | undefined, key: string): unknown {
  return record?.[key];
}

function readFirstMetric(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = record[key];

    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return undefined;
}

function readIntervalMetric(
  flat: Record<string, unknown>,
  nested: Record<string, unknown> | undefined,
  base: "volume" | "swaps" | "buys" | "sells",
  interval: string,
): unknown {
  return readFirstMetric(flat, intervalMetricKeys(base, interval)) ??
    readFirstMetric(nested ?? {}, intervalMetricKeys(base, interval));
}

function intervalMetricKeys(base: "volume" | "swaps" | "buys" | "sells", interval: string): string[] {
  return [
    `${base}_${interval}`,
    `${base}${interval}`,
    `${base}_usd_${interval}`,
    `${base}Usd${interval}`,
    base,
    `${base}_24h`,
    `${base}24h`,
    `${base}_1h`,
    `${base}1h`,
  ];
}

function calculateMarketCap(price: unknown, supply: unknown): number | undefined {
  const numericPrice = toNumber(price);
  const numericSupply = toNumber(supply);

  if (numericPrice === undefined || numericSupply === undefined) {
    return undefined;
  }

  return numericPrice * numericSupply;
}

function calculatePriceChange(currentPrice: unknown, previousPrice: unknown): number | undefined {
  const current = toNumber(currentPrice);
  const previous = toNumber(previousPrice);

  if (current === undefined || previous === undefined || previous <= 0) {
    return undefined;
  }

  return ((current - previous) / previous) * 100;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function mergeDefined(...records: Array<Record<string, unknown>>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      if (value !== undefined) {
        result[key] = value;
      }
    }
  }

  return result;
}

function describeResponseShape(value: unknown): string {
  if (Array.isArray(value)) {
    return `array(length=${value.length})`;
  }

  if (!isRecord(value)) {
    return typeof value;
  }

  return `object(keys=${Object.keys(value).slice(0, 20).join(",")})`;
}

function formatCliError(error: unknown, cliCommand: string): string {
  if (isNodeError(error) && error.code === "ENOENT") {
    return `GMGN CLI command not found: ${cliCommand}. Run yarn install so the local ./node_modules/.bin/gmgn-cli binary exists.`;
  }

  if (error instanceof SyntaxError) {
    return `GMGN CLI returned non-JSON output. Run: ${cliCommand} market trending --chain sol --interval 1h --limit 3 --raw`;
  }

  if (error instanceof Error) {
    return `GMGN CLI trending failed: ${error.message}`;
  }

  return "GMGN CLI trending failed with an unknown error";
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

function isNodeError(error: unknown): error is Error & { code?: string } {
  return error instanceof Error && "code" in error;
}
