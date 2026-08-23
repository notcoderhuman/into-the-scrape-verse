const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const app = express();
const PORT = process.env.PORT || 3000;
const execFileAsync = promisify(execFile);

// Keep configuration in one place. The collector ID can be overridden without editing code.
const CONFIG = {
  collectorId: process.env.BRIGHT_DATA_COLLECTOR_ID || 'c_msx09cv3945korq8v',
  productUrl: 'https://shopalto.xyz/product/aurora-wireless-headphones',
  requiredFields: ['product_name', 'price', 'description', 'rating', 'primary_image_url'],
  historyFile: path.join(__dirname, 'data', 'healing-history.json'),
  demoProductFile: path.join(__dirname, 'data', 'demo-product.json'),
};

// Demo modes are computed from local fixture data only. They never run the collector,
// never fabricate recovery events, and never read or write the real recovery history.
const DEMO_MODES = new Set(['healthy', 'degraded', 'failed']);

app.use(express.static(path.join(__dirname, 'public')));

function isUsable(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

// A structured price (e.g. { value, currency, symbol }) is only usable when it
// actually carries a concrete value. A { value: null } price must count as unusable.
function isUsablePrice(price) {
  if (price && typeof price === 'object' && !Array.isArray(price)) {
    return isUsable(price.value);
  }
  return isUsable(price);
}

function isFieldUsable(field, value) {
  return field === 'price' ? isUsablePrice(value) : isUsable(value);
}

function validateProduct(product) {
  const missingFields = CONFIG.requiredFields.filter((field) => !isFieldUsable(field, product?.[field]));
  return { missingFields, status: missingFields.length === 0 ? 'healthy' : 'degraded' };
}

// A recovery is observed only when a previously unhealthy run becomes fully valid.
// recoveredFields reflects exactly what was missing in that previous state, so a prior
// failure (which carries no per-field detail) never claims specific fields were recovered.
function detectRecovery(history, status, timestamp) {
  if (status === 'healthy' && ['degraded', 'failed'].includes(history.lastStatus)) {
    return {
      timestamp,
      previousStatus: history.lastStatus,
      currentStatus: status,
      recoveredFields: Array.isArray(history.lastMissingFields) ? history.lastMissingFields : [],
    };
  }
  return null;
}

async function readHistory() {
  try {
    return JSON.parse(await fs.readFile(CONFIG.historyFile, 'utf8'));
  } catch (error) {
    // A corrupt or unavailable history file should not bring down the dashboard.
    console.error('Could not read recovery history:', error.message);
    return { lastStatus: null, lastMissingFields: [], events: [] };
  }
}

async function writeHistory(history) {
  await fs.writeFile(CONFIG.historyFile, `${JSON.stringify(history, null, 2)}\n`);
}

// The CLI normally prints JSON alone. This small extractor also tolerates a harmless
// status line before or after it without using eval or treating output as code.
function parseCliJson(output) {
  const text = output.trim();
  try {
    return JSON.parse(text);
  } catch {
    // Continue below: CLI progress text may surround the JSON result.
  }

  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== '{' && text[start] !== '[') continue;
    const opening = text[start];
    const closing = opening === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let end = start; end < text.length; end += 1) {
      const character = text[end];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
      } else if (character === '"') {
        inString = true;
      } else if (character === opening) {
        depth += 1;
      } else if (character === closing) {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(start, end + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  throw new Error('Bright Data CLI did not return valid JSON.');
}

async function runCollector() {
  // Run only the existing collector. Credentials stay inside the CLI's local login store.
  // Never log stdout/stderr because either can contain account-specific diagnostic details.
  if (!/^c_[a-zA-Z0-9]+$/.test(CONFIG.collectorId)) {
    throw new Error('The configured Bright Data collector ID is invalid.');
  }

  const bdataArgs = ['scraper', 'run', CONFIG.collectorId, CONFIG.productUrl, '--pretty'];
  // npm installs a Windows command-wrapper for global CLIs. cmd.exe runs that wrapper
  // reliably; other platforms can execute bdata directly.
  const bdataCommand =
  process.platform === 'win32'
    ? (process.env.ComSpec || 'cmd.exe')
    : 'bdata';

const commandArgs =
  process.platform === 'win32'
    ? ['/d', '/s', '/c', `bdata ${bdataArgs.join(' ')}`]
    : bdataArgs;
  let stdout;
  try {
    ({ stdout } = await execFileAsync(bdataCommand, commandArgs, {
      timeout: 180000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    }));
  } catch {
    // Do not include raw CLI stdout/stderr in the API response or logs.
    throw new Error('Bright Data CLI could not complete the collector run. Confirm its local login and retry.');
  }

  const parsed = parseCliJson(stdout);
  const product = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!product || typeof product !== 'object' || Array.isArray(product)) {
    throw new Error('Bright Data CLI returned no usable product result.');
  }
  return product;
}

app.get('/api/dashboard', async (req, res) => {
  const demoMode = typeof req.query.demo === 'string' ? req.query.demo : null;
  const timestamp = new Date().toISOString();

  // ---- Demo mode: fixtures only. The real recovery history is read for display
  // ---- but never modified, and no recovery events are fabricated. ----
  if (demoMode && DEMO_MODES.has(demoMode)) {
    const history = await readHistory();
    try {
      if (demoMode === 'failed') {
        return res.json({
          status: 'failed',
          product: null,
          missingFields: CONFIG.requiredFields,
          recoveryEvent: null,
          history: history.events,
          collectorId: CONFIG.collectorId,
          checkedAt: timestamp,
          demo: demoMode,
          error: 'Demo Mode: simulated collector failure.',
        });
      }

      const product = JSON.parse(await fs.readFile(CONFIG.demoProductFile, 'utf8'));
      if (demoMode === 'degraded') product.price = null;
      const { status, missingFields } = validateProduct(product);
      return res.json({
        status,
        product,
        missingFields,
        recoveryEvent: null,
        history: history.events,
        collectorId: CONFIG.collectorId,
        checkedAt: timestamp,
        demo: demoMode,
      });
    } catch (error) {
      console.error('Demo dashboard run failed:', error.message);
      return res.status(500).json({
        status: 'failed',
        product: null,
        missingFields: CONFIG.requiredFields,
        recoveryEvent: null,
        history: history.events,
        collectorId: CONFIG.collectorId,
        checkedAt: timestamp,
        demo: demoMode,
        error: 'Demo fixture could not be loaded.',
      });
    }
  }

  // ---- Live mode: real collector run with real recovery history. ----
  const history = await readHistory();
  try {
    const product = await runCollector();
    const { status, missingFields } = validateProduct(product);
    const recoveryEvent = detectRecovery(history, status, timestamp);
    if (recoveryEvent) history.events.unshift(recoveryEvent);

    history.lastStatus = status;
    history.lastMissingFields = missingFields;
    await writeHistory(history);

    return res.json({
      status,
      product,
      missingFields,
      recoveryEvent,
      history: history.events,
      collectorId: CONFIG.collectorId,
      checkedAt: timestamp,
    });
  } catch (error) {
    // Keep errors useful, but do not return CLI output where credentials could appear.
    const message = error.message || 'Bright Data CLI execution failed.';
    console.error('Dashboard run failed:', message);
    history.lastStatus = 'failed';
    // A failed run carries no per-field detail, so it must not later claim that specific
    // fields were recovered. Record an empty missing-field list instead of every field.
    history.lastMissingFields = [];
    await writeHistory(history).catch((historyError) => console.error('Could not save failed status:', historyError.message));

    return res.status(502).json({
      status: 'failed',
      product: null,
      missingFields: CONFIG.requiredFields,
      recoveryEvent: null,
      history: history.events,
      collectorId: CONFIG.collectorId,
      checkedAt: timestamp,
      error: message,
    });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`ScrapeShield is running at http://localhost:${PORT}`);
  });
}

// Exported for lightweight unit tests (see `npm test`). Importing this module does not
// start the HTTP server thanks to the require.main guard above.
module.exports = {
  app,
  isUsable,
  isUsablePrice,
  isFieldUsable,
  validateProduct,
  detectRecovery,
};
