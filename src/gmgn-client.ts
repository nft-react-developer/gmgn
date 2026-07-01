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
  if (!isRecord(value)) {
    return [];
  }

  if (isRecord(value.token)) {
    return normalizeTrendingToken({
      ...value.token,
      ...value,
      token: undefined,
    });
  }

  const address = readString(value.address) ??
    readString(value.token_address) ??
    readString(value.contract_address) ??
    readString(value.ca);

  if (address === undefined || address.length === 0) {
    return [];
  }

  return [{
    ...value,
    address,
    market_cap: value.market_cap ?? value.marketcap,
    launchpad_platform: value.launchpad_platform ?? value.platform,
    price_change_percent: value.price_change_percent ?? value.change,
    holder_count: value.holder_count ?? value.holders,
    rat_trader_amount_rate: value.rat_trader_amount_rate ?? value.insider_rate,
    bundler_rate: value.bundler_rate ?? value.bundler_trader_amount_rate,
    top_10_holder_rate: value.top_10_holder_rate ?? value.top10_holder_rate,
  } as TrendingToken];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
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

function isNodeError(error: unknown): error is Error & { code?: string } {
  return error instanceof Error && "code" in error;
}
