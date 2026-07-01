import { loadConfig } from "./config.js";
import { GmgnClient } from "./gmgn-client.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const gmgn = new GmgnClient(
    config.gmgn.apiKey,
    config.gmgn.baseUrl,
    config.retry,
    config.gmgn.marketSource,
    config.gmgn.cliCommand,
  );

  const tokens = await gmgn.getTrendingRank({
    chain: config.trending.chain,
    interval: config.trending.interval,
    limit: Math.min(config.trending.limit, 5),
    orderBy: config.trending.orderBy,
    direction: config.trending.direction,
  });

  console.log(`GMGN trending smoke OK. Tokens returned: ${tokens.length}`);

  for (const token of tokens) {
    console.log(`${token.rank ?? "-"} ${token.symbol ?? "UNKNOWN"} ${token.address}`);
  }
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  console.error("Unknown fatal error");
  process.exitCode = 1;
});
