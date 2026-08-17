# ScrapeShield

ScrapeShield is a small web-data reliability dashboard for the team's existing Bright Data Scraper Studio product collector. It shows the latest structured product result, identifies missing required fields, and records observed recoveries.

## Architecture

The browser loads a plain HTML/CSS/JavaScript dashboard from Express. The dashboard calls `GET /api/dashboard`. The server triggers the existing published Bright Data collector, polls its dataset result, validates the returned product data, and stores a tiny local recovery history in `data/healing-history.json`.

## Bright Data use

The application uses the existing collector ID `c_msx09cv3945korq8v` (or `BRIGHT_DATA_COLLECTOR_ID` if supplied). Local development uses the already-authenticated globally installed Bright Data CLI, running this read-only command from the server:

```text
bdata scraper run c_msx09cv3945korq8v https://shopalto.xyz/product/aurora-wireless-headphones --pretty
```

The CLI uses its existing local login, so `BRIGHT_DATA_API_TOKEN` is not needed for the normal local run path. The server never prints CLI output or credentials. The command only runs the existing collector; it never creates, heals, approves, or modifies it.

Optionally override the collector ID (no secret is needed):

```powershell
$env:BRIGHT_DATA_COLLECTOR_ID = "c_msx09cv3945korq8v"
```

## Health validation

The required fields are `product_name`, `price`, `description`, `rating`, and `primary_image_url`. A non-empty value for every field is **healthy**. A result with any missing, null, or empty required field is **degraded**. A failed collector call, empty result, or timeout is **failed**.

## Recovery history

After each dashboard run, the server records its latest health state. When the previous state was `degraded` or `failed` and the next state is `healthy`, ScrapeShield records a recovery event with its timestamp, prior status, current status, and the fields that were previously missing. This is an observed recovery only; the app does not alter Bright Data.

## Install and run

Requires Node.js 18 or newer.

```powershell
npm install --package-lock=false
npm start
```

Open [http://localhost:3000](http://localhost:3000). Use the **Refresh data** button to request a new collector run.

## Team note

AI coding assistance was used to create this starter application. The team has reviewed and tested the code and remains responsible for its behavior and deployment.
