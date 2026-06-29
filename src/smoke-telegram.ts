import { loadConfig } from "./config.js";
import { TelegramNotifier } from "./telegram-notifier.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const notifier = new TelegramNotifier(
    config.telegram.botToken,
    config.telegram.chatId,
    config.telegram.apiBaseUrl,
  );

  await notifier.sendMessage("GMGN Solana monitor Telegram smoke test OK.");
  console.log("Telegram smoke test sent.");
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
