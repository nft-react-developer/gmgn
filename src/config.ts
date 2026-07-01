export type AppConfig = {
  gmgn: {
    apiKey: string;
    baseUrl: string;
    marketSource: "cli" | "openapi";
    cliCommand: string;
  };
  telegram: {
    botToken: string;
    chatId: string;
    apiBaseUrl: string;
  };
  monitor: {
    pollIntervalMs: number;
    commandPollIntervalMs: number;
    watchedTokenAddresses: string[];
  };
  retry: {
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
  };
  trending: {
    chain: "sol" | "bsc" | "base" | "eth";
    interval: "1m" | "5m" | "1h" | "6h" | "24h";
    limit: number;
    launchpadPlatforms: string[];
    orderBy: string;
    direction: "asc" | "desc";
    requireLaunchpadMatch: boolean;
    addressSuffixFallback: boolean;
    fallbackAddressSuffix: string;
  };
  fastGrowth: {
    minVolumeUsd: number;
    minSwaps: number;
    minLiquidityUsd: number;
    minPriceChangePercent: number;
    minHotLevel: number;
    minBuySellRatio: number;
    volumeGrowthMultiplier: number;
    alertCooldownMs: number;
    minTraderScore: number;
    minHolderCount: number;
    maxTop10HolderRate: number;
    minSmartDegenCount: number;
    minRenownedCount: number;
    maxRugRatio: number;
    maxBundlerRate: number;
    maxInsiderRate: number;
  };
};

export class ConfigError extends Error {
  constructor(readonly missingKeys: string[]) {
    super(`Missing required environment variables: ${missingKeys.join(", ")}`);
    this.name = "ConfigError";
  }
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  loadProjectEnvFile();

  const missingKeys = requiredKeys.filter((key) => isBlank(env[key]));

  if (missingKeys.length > 0) {
    throw new ConfigError(missingKeys);
  }

  return {
    gmgn: {
      apiKey: env.GMGN_API_KEY as string,
      baseUrl: readUrl(env.GMGN_BASE_URL, "https://openapi.gmgn.ai"),
      marketSource: readEnum(env.GMGN_MARKET_SOURCE, ["cli", "openapi"], "cli"),
      cliCommand: env.GMGN_CLI_COMMAND?.trim() || "./node_modules/.bin/gmgn-cli",
    },
    telegram: {
      botToken: env.TELEGRAM_BOT_TOKEN as string,
      chatId: env.TELEGRAM_CHAT_ID as string,
      apiBaseUrl: readUrl(env.TELEGRAM_API_BASE_URL, "https://api.telegram.org"),
    },
    monitor: {
      pollIntervalMs: readPositiveInteger(env.POLL_INTERVAL_MS, 30_000),
      commandPollIntervalMs: readPositiveInteger(env.COMMAND_POLL_INTERVAL_MS, 5_000),
      watchedTokenAddresses: readCsv(env.WATCHED_TOKEN_ADDRESSES),
    },
    retry: {
      maxAttempts: readIntegerInRange(env.RETRY_MAX_ATTEMPTS, 3, 1, 10),
      baseDelayMs: readIntegerInRange(env.RETRY_BASE_DELAY_MS, 500, 0, 60_000),
      maxDelayMs: readIntegerInRange(env.RETRY_MAX_DELAY_MS, 5_000, 0, 300_000),
    },
    trending: {
      chain: readEnum(env.TRENDING_CHAIN, ["sol", "bsc", "base", "eth"], "sol"),
      interval: readEnum(env.TRENDING_INTERVAL, ["1m", "5m", "1h", "6h", "24h"], "1m"),
      limit: readIntegerInRange(env.TRENDING_LIMIT, 50, 1, 100),
      launchpadPlatforms: readCsv(env.TRENDING_PLATFORMS, ["Pump.fun"]),
      orderBy: env.TRENDING_ORDER_BY?.trim() || "volume",
      direction: readEnum(env.TRENDING_DIRECTION, ["asc", "desc"], "desc"),
      requireLaunchpadMatch: readBoolean(env.REQUIRE_LAUNCHPAD_MATCH, true),
      addressSuffixFallback: readBoolean(env.PUMPFUN_ADDRESS_SUFFIX_FALLBACK, false),
      fallbackAddressSuffix: env.PUMPFUN_ADDRESS_SUFFIX?.trim() || "pump",
    },
    fastGrowth: {
      minVolumeUsd: readNonNegativeNumber(env.MIN_VOLUME_USD, 10_000),
      minSwaps: readIntegerInRange(env.MIN_SWAPS, 20, 0, Number.MAX_SAFE_INTEGER),
      minLiquidityUsd: readNonNegativeNumber(env.MIN_LIQUIDITY_USD, 10_000),
      minPriceChangePercent: readNumber(env.MIN_PRICE_CHANGE_PERCENT, 8),
      minHotLevel: readNonNegativeNumber(env.MIN_HOT_LEVEL, 1),
      minBuySellRatio: readNonNegativeNumber(env.MIN_BUY_SELL_RATIO, 1.3),
      volumeGrowthMultiplier: readNonNegativeNumber(env.VOLUME_GROWTH_MULTIPLIER, 2),
      alertCooldownMs: readIntegerInRange(env.ALERT_COOLDOWN_MS, 600_000, 0, Number.MAX_SAFE_INTEGER),
      minTraderScore: readNonNegativeNumber(env.MIN_TRADER_SCORE, 75),
      minHolderCount: readIntegerInRange(env.MIN_HOLDER_COUNT, 50, 0, Number.MAX_SAFE_INTEGER),
      maxTop10HolderRate: readNonNegativeNumber(env.MAX_TOP_10_HOLDER_RATE, 0.35),
      minSmartDegenCount: readIntegerInRange(env.MIN_SMART_DEGEN_COUNT, 0, 0, Number.MAX_SAFE_INTEGER),
      minRenownedCount: readIntegerInRange(env.MIN_RENOWNED_COUNT, 0, 0, Number.MAX_SAFE_INTEGER),
      maxRugRatio: readNonNegativeNumber(env.MAX_RUG_RATIO, 0.3),
      maxBundlerRate: readNonNegativeNumber(env.MAX_BUNDLER_RATE, 0.3),
      maxInsiderRate: readNonNegativeNumber(env.MAX_INSIDER_RATE, 0.3),
    },
  };
}

function loadProjectEnvFile(): void {
  try {
    process.loadEnvFile?.(".env");
  } catch (error) {
    if (isMissingEnvFileError(error)) {
      return;
    }

    throw error;
  }
}

function isMissingEnvFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

const requiredKeys = ["GMGN_API_KEY", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"] as const;

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim().length === 0;
}

function readUrl(value: string | undefined, fallback: string): string {
  const rawValue = value?.trim() || fallback;
  const url = new URL(rawValue);
  return url.origin;
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = isBlank(value) ? fallback : Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, got: ${value}`);
  }

  return parsed;
}

function readCsv(value: string | undefined, fallback: string[] = []): string[] {
  if (isBlank(value)) {
    return fallback;
  }

  return value!
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function readEnum<const TValue extends string>(
  value: string | undefined,
  allowedValues: readonly TValue[],
  fallback: TValue,
): TValue {
  if (isBlank(value)) {
    return fallback;
  }

  if (allowedValues.includes(value as TValue)) {
    return value as TValue;
  }

  throw new Error(`Expected one of ${allowedValues.join(", ")}, got: ${value}`);
}

function readNumber(value: string | undefined, fallback: number): number {
  if (isBlank(value)) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected a number, got: ${value}`);
  }

  return parsed;
}

function readNonNegativeNumber(value: string | undefined, fallback: number): number {
  const parsed = readNumber(value, fallback);

  if (parsed < 0) {
    throw new Error(`Expected a non-negative number, got: ${value}`);
  }

  return parsed;
}

function readIntegerInRange(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = isBlank(value) ? fallback : Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Expected an integer between ${min} and ${max}, got: ${value}`);
  }

  return parsed;
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (isBlank(value)) {
    return fallback;
  }

  const normalized = value!.trim().toLowerCase();

  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`Expected a boolean, got: ${value}`);
}
