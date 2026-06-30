# GMGN Solana Monitor Product

This product is a Telegram alert bot for discovering early Solana memecoin momentum, starting with Pump.fun tokens surfaced by GMGN.

## Product goal

Help a trader notice fast-moving Solana launchpad tokens early enough to review them manually before the opportunity disappears.

## Target user

A discretionary Solana memecoin trader who wants Telegram alerts for tokens that show unusual activity, but still makes the final trading decision manually.

## Current value proposition

The bot reduces manual scanning by combining:

- GMGN trending rank data;
- Pump.fun / launchpad source validation;
- liquidity, volume, and swap thresholds;
- buy/sell pressure;
- short-term price momentum;
- separated score buckets for momentum, liquidity, holders/risk, and manipulation;
- risk filters for wash trading, rug ratio, bundlers, and insiders;
- Telegram alerts and a minimal `/status` command.

## Current scope

| In scope | Out of scope |
|---|---|
| Monitoring GMGN trending tokens | Automated buy/sell execution |
| Pump.fun and configurable launchpad filters | Wallet custody or key management |
| Telegram alerts | PnL tracking |
| Manual smoke tests | Backtesting |
| Basic command handling | Multi-user access control beyond one chat ID |

## Trader workflow

1. Configure `.env` with GMGN and Telegram credentials.
2. Start the monitor.
3. Receive Telegram alerts when a token crosses the fast-growth model.
4. Open the GMGN token link.
5. Manually inspect chart, holders, liquidity, socials, and risk.
6. Decide whether to trade outside this bot.

## Product risks

| Risk | Why it matters | Current mitigation |
|---|---|---|
| False positives | Memecoins spike often and many moves fade quickly. | Score threshold, cooldown, and multiple signal checks. |
| API field drift | GMGN fields may change or be missing. | Defensive parsing and optional-field handling. |
| Restart blindness | In-memory snapshots reset on restart. | None yet; persistence is a recommended next step. |
| Slow reaction time | Market polling can be slower than Telegram commands. | Separate command and market polling intervals. |
| Overconfidence | Alerts are not trade recommendations. | Bot only alerts; it does not execute trades. |

## Next product improvements

1. Tune the separated trader score with real alert outcomes and missed opportunities.
2. Add configurable alert tiers: watch, strong, and urgent.
3. Add deduped token history so alerts show what changed since the previous alert.
4. Add a daily digest of best alerts and ignored tokens.
5. Add a manual `/watch <address>` command for high-conviction tokens.
6. Add backtesting against historical snapshots before tightening thresholds.
