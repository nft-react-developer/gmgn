import { ConfigError, loadConfig } from "./config.js";
import { startMonitor } from "./monitor.js";

async function main(): Promise<void> {
  const config = loadConfig();
  await startMonitor(config);
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  if (error instanceof Error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  console.error("Unknown fatal error");
  process.exitCode = 1;
});
