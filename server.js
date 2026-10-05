import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { parishRepository } from './src/repositories/parishRepository.js';
import { scrapeIngestionService } from './src/services/scrapeIngestionService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const SCRAPER_SCRIPT = path.resolve(__dirname, 'src/scraper/main.py');
const SCRAPER_ROUTES = {
  st_john_btn: { host: 'stjohnkl.com.my', names: ['Cathedral of St John the Evangelist'] },
  holy_rosary_btn: { host: 'hrckl.com', names: ['Holy Rosary Church'] },
  ofkl: { host: 'olfkl.com', names: ['Church of Our Lady of Fatima', 'Church of Our Lady of Fatima (OFKL)'] },
  assumption_pj_btn: { host: 'assumptionpj.org', names: ['Assumption Church PJ', 'Assumption Church'] },
};

const getConfiguredParish = (parishes, route) => parishes.find((parish) => {
  const scrapeUrl = String(parish.target_scrape_url || '').toLowerCase();
  const parishName = String(parish.name || '').toLowerCase();
  return scrapeUrl.includes(route.host) || route.names.some((name) => parishName === name.toLowerCase());
});

app.use(express.json());
app.use(
  cors({
    origin: 'http://localhost:5173'
  })
);

app.post('/api/scrape', async (req, res) => {
  const { adminId, triggerId, startDate } = req.body ?? {};

  if (adminId === undefined || triggerId === undefined) {
    return res.status(400).json({
      error: 'Request body must include adminId, triggerId, and templateId.'
    });
  }

  if (parseInt(adminId, 10) !== 1) {
    return res.status(403).json({
      error: 'Access Denied: Scraping capabilities are restricted to the System Super Admin.'
    });
  }

  let targetParishId = null;
  let syncLabel = "Scraped Week";
  const scraperRoute = SCRAPER_ROUTES[triggerId];

  if (!scraperRoute) {
    return res.status(400).json({ error: `Unknown scraper trigger: ${triggerId}` });
  }

  try {
    const parishes = await parishRepository.findAll();
    const configuredParish = getConfiguredParish(parishes, scraperRoute);
    if (!configuredParish) {
      return res.status(500).json({ error: `No parish is configured for scraper ${triggerId}.` });
    }

    targetParishId = configuredParish.parish_id;
    syncLabel = configuredParish.name;
  } catch (err) {
    console.error('[Template validation failure]', err);
  }

  const temporaryProcessId = Math.floor(Math.random() * 10000);
  const scraperProcess = spawn('python', [SCRAPER_SCRIPT, String(triggerId), String(temporaryProcessId)], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let outputData = '';
  let stderrBuffer = '';

  scraperProcess.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    outputData += text;
    process.stdout.write(`[scraper stdout] ${text}`);
  });

  scraperProcess.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    stderrBuffer += text;
    process.stderr.write(`[scraper stderr] ${text}`);
  });

  scraperProcess.on('error', (error) => {
    console.error('[scraper error]', error);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Scraper failed to start.',
        stage: 'spawn_python_process',
        detail: error.message
      });
    }
  });

  scraperProcess.on('close', async (code) => {
    if (res.headersSent) {
      return;
    }

    if (code === 0) {
      try {
        const jsonStartIndex = outputData.indexOf('{');
        if (jsonStartIndex === -1) {
          throw new Error("No valid JSON payload found in scraper stdout.");
        }
        const cleanJsonString = outputData.substring(jsonStartIndex).trim();
        const payload = JSON.parse(cleanJsonString);

        const finalStartDate = payload.start_date || startDate || null;
        const schedules = Array.isArray(payload.schedules) ? payload.schedules : [];

        const ingestionResult = await scrapeIngestionService.replaceParishDraftOccurrences(
          targetParishId,
          String(temporaryProcessId),
          payload.source || syncLabel,
          schedules,
          finalStartDate
        );

        return res.status(200).json({
          success: true,
          message: `Successfully scraped and staged ${ingestionResult.insertedCount} parish schedules for review.`,
          source: payload.source || null,
          schedules: ingestionResult.occurrences,
          insertedCount: ingestionResult.insertedCount,
          parish_id: targetParishId
        });
      } catch (error) {
        console.error('[scraper import error]', error);
        return res.status(500).json({
          success: false,
          error: 'Scraper completed, but importing draft schedules failed.',
          stage: 'import_to_supabase',
          detail: error.message
        });
      }
    }

    let stage = 'unknown';
    let detail = `Scraper process exited with code ${code}.`;
    const stderrLines = stderrBuffer
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    for (let i = stderrLines.length - 1; i >= 0; i -= 1) {
      try {
        const parsed = JSON.parse(stderrLines[i]);
        stage = parsed.stage || stage;
        detail = parsed.error || detail;
        break;
      } catch {
        // Ignore lines that aren't valid JSON
      }
    }

    if (stage === 'unknown' && stderrLines.length > 0) {
      const stageMatch = stderrBuffer.match(/\[(?<stage>[^\]]+)\]/);
      if (stageMatch?.groups?.stage) {
        stage = stageMatch.groups.stage;
      } else if (/ModuleNotFoundError|ImportError/.test(stderrBuffer)) {
        stage = 'bootstrap_python_import';
      } else if (/Traceback/.test(stderrBuffer)) {
        stage = 'python_runtime';
      }

      if (detail.startsWith('Scraper process exited with code')) {
        detail = stderrLines.slice(-6).join('\n');
      }
    }

    return res.status(500).json({
      error: `Scraper failed at stage: ${stage}`,
      stage,
      detail
    });
  });
});

app.listen(PORT, () => {
  console.log(`Local API server running on http://localhost:${PORT}`);
});

export default app;