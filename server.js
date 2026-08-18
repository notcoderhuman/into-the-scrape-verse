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
};

app.use(express.static(path.join(__dirname, 'public')));

function isUsable(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function validateProduct(product) {
  const missingFields = CONFIG.requiredFields.filter((field) => !isUsable(product?.[field]));
  return { missingFields, status: missingFields.length === 0 ? 'healthy' : 'degraded' };
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
  const demoMode = req.query.demo;
  const history = await readHistory();
  const timestamp = new Date().toISOString();

  try {
    let product;

if (demoMode === 'degraded') {
  product = JSON.parse(
    await fs.readFile(
      path.join(__dirname, 'data', 'demo-product.json'),
      'utf8'
    )
  );
  product.price = null;
} else if (demoMode === 'failed') {
  throw new Error('Demo Mode: simulated collector failure.');
} else {
  product = await runCollector();
}

const { status, missingFields } = validateProduct(product);
    let recoveryEvent = null;

    // A recovery is observed when a previously unhealthy run becomes fully valid.
    if (status === 'healthy' && ['degraded', 'failed'].includes(history.lastStatus)) {
      recoveryEvent = {
        timestamp,
        previousStatus: history.lastStatus,
        currentStatus: status,
        recoveredFields: history.lastMissingFields,
      };
      history.events.unshift(recoveryEvent);
    }

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
    history.lastMissingFields = CONFIG.requiredFields;
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

app.listen(PORT, () => {
  console.log(`ScrapeShield is running at http://localhost:${PORT}`);
});
