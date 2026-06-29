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
};

type QueryParams = Record<string, string | string[]>;

export class GmgnClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
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

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "X-APIKEY": this.apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`GMGN request failed with HTTP ${response.status}`);
    }

    return (await response.json()) as TResponse;
  }

  async getTrendingRank(params: {
    chain: string;
    interval: string;
    limit: number;
    orderBy: string;
    direction: string;
    launchpadPlatforms: string[];
    minVolumeUsd: number;
    minSwaps: number;
    minLiquidityUsd: number;
    maxRugRatio: number;
    maxBundlerRate: number;
    maxInsiderRate: number;
  }): Promise<TrendingToken[]> {
    const data = await this.getOpenApiData<TrendingRankData>("/v1/market/rank", {
      chain: params.chain,
      interval: params.interval,
      limit: String(params.limit),
      order_by: params.orderBy,
      direction: params.direction,
      platform: params.launchpadPlatforms,
      min_volume: String(params.minVolumeUsd),
      min_swaps: String(params.minSwaps),
      min_liquidity: String(params.minLiquidityUsd),
      max_rug_ratio: String(params.maxRugRatio),
      max_bundler_rate: String(params.maxBundlerRate),
      max_insider_rate: String(params.maxInsiderRate),
    });

    return data.rank ?? [];
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
