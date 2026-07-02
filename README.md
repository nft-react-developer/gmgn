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

- `GMGN_MARKET_SOURCE`
- `GMGN_CLI_COMMAND`
- `POLL_INTERVAL_MS`
- `COMMAND_POLL_INTERVAL_MS`
- `WATCHED_TOKEN_ADDRESSES`
- `RETRY_MAX_ATTEMPTS`
- `RETRY_BASE_DELAY_MS`
- `RETRY_MAX_DELAY_MS`
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
- `MIN_TRADER_SCORE`
- `MIN_HOLDER_COUNT`
- `MAX_TOP_10_HOLDER_RATE`
- `MIN_SMART_DEGEN_COUNT`
- `MIN_RENOWNED_COUNT`
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
- consulta trending con `gmgn-cli market trending` por defecto;
- trae trending amplio desde GMGN y aplica filtros localmente para que los logs expliquen cada descarte;
- filtra localmente por launchpad configurable, por defecto `Pump.fun`;
- envía alertas de fast growth por volumen, swaps, hot level, momentum y aceleración.
- atiende comandos de Telegram solo desde `TELEGRAM_CHAT_ID`; cualquier otro chat se ignora.

## Fast growth alert

Configuración recomendada inicial:

```env
TRENDING_CHAIN=sol
GMGN_MARKET_SOURCE=cli
GMGN_CLI_COMMAND=./node_modules/.bin/gmgn-cli
TRENDING_INTERVAL=1m
TRENDING_LIMIT=50
TRENDING_PLATFORMS=Pump.fun
TRENDING_ORDER_BY=volume
TRENDING_DIRECTION=desc
COMMAND_POLL_INTERVAL_MS=5000
TOKEN_ANALYTICS_STORE_PATH=data/token-performance.json
DEFAULT_TRACK_HOURS=6
RETRY_MAX_ATTEMPTS=3
RETRY_BASE_DELAY_MS=500
RETRY_MAX_DELAY_MS=5000
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
MIN_TRADER_SCORE=75
MIN_HOLDER_COUNT=50
MAX_TOP_10_HOLDER_RATE=0.35
MIN_SMART_DEGEN_COUNT=0
MIN_RENOWNED_COUNT=0
MAX_RUG_RATIO=0.3
MAX_BUNDLER_RATE=0.3
MAX_INSIDER_RATE=0.3
```

La estrategia separa el score trader en momentum, liquidez, holders/riesgo y
manipulación. Busca tokens con volumen fuerte, actividad real, momentum de
precio, buy pressure y aceleración respecto del poll anterior. También aplica
filtros de riesgo configurables para rug ratio, bundlers e insiders.

Telegram y GMGN corren en loops separados: `COMMAND_POLL_INTERVAL_MS` controla
la respuesta a comandos y `POLL_INTERVAL_MS` controla el monitoreo de mercado.
Las llamadas HTTP a GMGN y Telegram usan retry con backoff exponencial y jitter
para errores transitorios como 408, 429 y 5xx.

Por defecto el bot usa la fuente oficial `gmgn-cli market trending` porque la
documentación actual de GMGN expone trending vía CLI. Si necesitás probar el
endpoint antiguo, podés usar `GMGN_MARKET_SOURCE=openapi`, pero el modo
recomendado es `cli`. La CLI se usa como dependencia local del proyecto
(`./node_modules/.bin/gmgn-cli`), no como instalación global.

## Market diagnostics logs

Cada poll de mercado imprime logs para entender si GMGN está devolviendo tokens
y dónde se están filtrando:

- `snapshot`: conteos por etapa (`gmgn`, `launchpad_kept`, `watchlist_kept`,
  `scored`, `new`, `alerts`, `blocked`, `rejected`, `cooldown`) e incluye
  `source=<cli|openapi>` y `server_filters=off` porque los filtros fuertes se
  aplican localmente;
- `raw GMGN sample`: muestra tokens crudos devueltos por GMGN;
- `launchpad dropped`: muestra tokens descartados por plataforma;
- `watchlist dropped`: solo aparece si `WATCHED_TOKEN_ADDRESSES` está activo;
- `new tokens after filters`: tokens vistos por primera vez después de filtros;
- `blocked by manipulation`: tokens bloqueados por wash trading/rug/bundler/insiders;
- `rejected by thresholds`: tokens que no llegaron a volumen/swaps/liquidez/score;
- `top scored candidates`: mejores candidatos aunque no hayan disparado alerta.

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
- `/analyze <token-address>`: consulta GMGN para ese token, calcula el score actual
  y explica si habría disparado alerta o qué filtro lo bloqueó.
- `/track <token-address> [hours]`: guarda snapshots periódicos del token durante
  la ventana indicada; por defecto usa `DEFAULT_TRACK_HOURS`.
- `/missed <token-address>`: marca un falso negativo manual y guarda el análisis
  para revisar qué filtro dejó afuera una oportunidad.
- `/label <token-address> good|bad|noise`: etiqueta el token después de revisarlo.
- `/review`: resume tokens trackeados, falsos negativos, etiquetas y motivos de
  rechazo más frecuentes.

Los datos de aprendizaje se guardan en JSON local, por defecto en
`data/token-performance.json`. Ese directorio está ignorado por git porque contiene
datos runtime, no configuración del proyecto.

Al arrancar, el bot registra estos comandos con Telegram `setMyCommands`, así
Telegram los sugiere al escribir `/`.
