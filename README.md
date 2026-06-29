# GMGN Solana Monitor Bot

Bot de monitoreo para actividad/trending de tokens Solana con:

- Node.js
- TypeScript
- Telegram Bot API
- Native `fetch`
- Sin `axios`
- Sin `dotenv`: Node carga `.env` con `--env-file`

## Setup

Copiá `.env.example` a `.env` y completá los valores:

```bash
cp .env.example .env
```

Variables requeridas:

- `GMGN_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

Variables opcionales:

- `POLL_INTERVAL_MS`
- `WATCHED_TOKEN_ADDRESSES`
- `GMGN_BASE_URL`
- `TELEGRAM_API_BASE_URL`
- `TRENDING_CHAIN`
- `TRENDING_INTERVAL`
- `TRENDING_LIMIT`
- `TRENDING_PLATFORMS`
- `TRENDING_ORDER_BY`
- `TRENDING_DIRECTION`
- `REQUIRE_LAUNCHPAD_MATCH`
- `PUMPFUN_ADDRESS_SUFFIX_FALLBACK`
- `PUMPFUN_ADDRESS_SUFFIX`
- `MIN_VOLUME_USD`
- `MIN_SWAPS`
- `MIN_LIQUIDITY_USD`
- `MIN_PRICE_CHANGE_PERCENT`
- `MIN_HOT_LEVEL`
- `MIN_BUY_SELL_RATIO`
- `VOLUME_GROWTH_MULTIPLIER`
- `ALERT_COOLDOWN_MS`
- `MAX_RUG_RATIO`
- `MAX_BUNDLER_RATE`
- `MAX_INSIDER_RATE`

## Scripts

```bash
yarn install
yarn check
yarn build
yarn dev
yarn smoke:telegram
yarn smoke:gmgn-trending
yarn start
```

## Estado actual

La base del bot ya queda preparada:

- carga configuración desde `.env` en runtime;
- valida variables requeridas sin imprimir secretos;
- envía notificación de arranque a Telegram;
- consulta GMGN OpenAPI `GET /v1/market/rank` usando `X-APIKEY`;
- filtra por launchpad configurable, por defecto `Pump.fun`;
- envía alertas de fast growth por volumen, swaps, hot level, momentum y aceleración.
- atiende comandos de Telegram solo desde `TELEGRAM_CHAT_ID`; cualquier otro chat se ignora.

## Fast growth alert

Configuración recomendada inicial:

```env
TRENDING_CHAIN=sol
TRENDING_INTERVAL=1m
TRENDING_LIMIT=50
TRENDING_PLATFORMS=Pump.fun
TRENDING_ORDER_BY=volume
TRENDING_DIRECTION=desc
REQUIRE_LAUNCHPAD_MATCH=true
PUMPFUN_ADDRESS_SUFFIX_FALLBACK=false
PUMPFUN_ADDRESS_SUFFIX=pump
MIN_VOLUME_USD=10000
MIN_SWAPS=20
MIN_LIQUIDITY_USD=10000
MIN_PRICE_CHANGE_PERCENT=8
MIN_HOT_LEVEL=1
MIN_BUY_SELL_RATIO=1.3
VOLUME_GROWTH_MULTIPLIER=2
ALERT_COOLDOWN_MS=600000
MAX_RUG_RATIO=0.3
MAX_BUNDLER_RATE=0.3
MAX_INSIDER_RATE=0.3
```

La estrategia busca tokens con volumen fuerte, actividad real, momentum de precio,
buy pressure y aceleración respecto del poll anterior. También aplica filtros de
riesgo configurables para rug ratio, bundlers e insiders.

`TRENDING_PLATFORMS` acepta más de un launchpad separado por coma:

```env
TRENDING_PLATFORMS=Pump.fun,letsbonk,moonshot_app
```

## Pump.fun validation

La validación fuerte usa `launchpad_platform` devuelto por GMGN y lo compara contra
`TRENDING_PLATFORMS`, por defecto `Pump.fun`.

La terminación del contrato en `pump` existe como fallback opcional:

```env
PUMPFUN_ADDRESS_SUFFIX_FALLBACK=true
```

No está activada por defecto porque es una heurística, no una prueba fuerte.

## Telegram commands

El bot ignora en silencio cualquier comando cuyo `chat.id` no coincida exactamente
con `TELEGRAM_CHAT_ID`.

Comandos permitidos:

- `/status`
