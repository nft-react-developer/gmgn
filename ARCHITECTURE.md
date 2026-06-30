# GMGN Solana Monitor Architecture

This project is a small TypeScript service that polls GMGN trending tokens, filters Solana launchpad tokens, scores fast-growth candidates, and sends Telegram alerts.

## Runtime flow

1. `src/main.ts` loads configuration and starts the monitor.
2. `src/monitor.ts` creates the GMGN client, Telegram notifier, command handler, and fast-growth detector.
3. The monitor loop:
   - polls Telegram commands in a dedicated command loop;
   - fetches GMGN trending rank data in a dedicated market loop;
   - validates the launchpad source;
   - optionally narrows results to watched addresses;
   - evaluates fast-growth signals;
   - sends Telegram alerts.

## Components

| Component | Responsibility |
|---|---|
| `src/config.ts` | Loads `.env`, validates required variables, and normalizes numeric, boolean, CSV, URL, and enum settings. |
| `src/gmgn-client.ts` | Wraps GMGN OpenAPI calls with `fetch`, API key headers, timestamp, and client ID. |
| `src/monitor.ts` | Coordinates the polling loop, source filtering, watched-token filtering, and alert delivery. |
| `src/fast-growth-alert.ts` | Scores token momentum using volume, swaps, liquidity, price change, buy/sell pressure, rank improvement, and risk filters. |
| `src/telegram-notifier.ts` | Sends Telegram messages and fetches Telegram updates. |
| `src/telegram-command-handler.ts` | Handles `/status` and `/help`, restricted to `TELEGRAM_CHAT_ID`. |
| `src/retry.ts` | Provides shared retry/backoff behavior for transient HTTP and network failures. |
| `src/smoke-*.ts` | Manual smoke tests for Telegram and GMGN connectivity. |

## Data sources and outputs

| Boundary | Direction | Details |
|---|---:|---|
| GMGN OpenAPI | Inbound | `GET /v1/market/rank` with configurable chain, interval, order, platform, and risk filters. |
| Telegram Bot API | Outbound | Sends startup, status, and fast-growth alert messages. |
| Telegram Bot API | Inbound | Polls bot commands and ignores all chats except the configured chat ID. |
| `.env` | Inbound | Runtime configuration and secrets. Secrets are not printed by the app. |

## Polling and resilience

Telegram commands and GMGN market checks run in separate loops:

- `COMMAND_POLL_INTERVAL_MS` controls Telegram command responsiveness.
- `POLL_INTERVAL_MS` controls GMGN market polling.

GMGN and Telegram HTTP calls use retry with exponential backoff and jitter for transient failures:

- HTTP `408`;
- HTTP `429`;
- HTTP `5xx`;
- network-level `TypeError` failures from `fetch`.

## Market diagnostics

Each GMGN market poll writes console diagnostics so filter tuning is observable:

| Log | Purpose |
|---|---|
| `snapshot` | Counts tokens returned, kept by launchpad, kept by watchlist, scored, new, alerted, blocked, rejected, and cooling down. |
| `raw GMGN sample` | Shows the first raw tokens returned by GMGN before local filters. |
| `launchpad dropped` | Shows tokens removed by launchpad validation. |
| `watchlist dropped` | Shows tokens removed by manual watchlist filtering when enabled. |
| `new tokens after filters` | Shows tokens first seen by the scoring engine. |
| `blocked by manipulation` | Shows manipulation filter failures. |
| `rejected by thresholds` | Shows candidates that missed volume, swaps, liquidity, or minimum trader score. |
| `top scored candidates` | Shows the strongest candidates even when they do not alert. |

## Alert model

The detector requires base liquidity/activity thresholds before alerting:

- minimum volume;
- minimum swaps;
- minimum liquidity;
- score of at least `MIN_TRADER_SCORE`.

It then separates the trader score into four buckets:

| Bucket | Signals |
|---|---|
| Momentum | Hot level, price change, buy/sell pressure, volume acceleration, rank improvement. |
| Liquidity | Volume, swaps, and liquidity floor. |
| Holders/Risk | Holder count, top-10 concentration, smart degen count, renowned wallet count. |
| Manipulation | Wash trading, rug ratio, bundler rate, insider / rat trader rate. |

It blocks alerts when risk signals exceed configured maximums:

- wash trading;
- rug ratio;
- bundler rate;
- insider / rat trader rate.

## Current constraints

- Runtime state is in memory only. Restarting loses previous snapshots and cooldown history.
- There are no automated unit tests yet.
- GMGN response fields are typed defensively because the API can return numbers as strings.
- Source validation depends primarily on GMGN `launchpad_platform`; the address suffix fallback is intentionally disabled by default because it is a heuristic.

## Improvement backlog

1. Add unit tests for config parsing, launchpad filtering, fast-growth scoring, and Telegram command authorization.
2. Persist snapshots and cooldowns to survive restarts.
3. Separate command polling from market polling so Telegram responsiveness does not depend on market API latency.
4. Add retry/backoff and clearer error classes for GMGN and Telegram failures.
5. Add structured logging with redaction for tokens, chat IDs, and API keys.
6. Add a paper-trading or watchlist review mode before any automated trading logic.
