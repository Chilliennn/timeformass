import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const SCRAPER_SCRIPT = path.resolve(__dirname, 'src/scraper/main.py');
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

const supabaseAdmin =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    : null;

app.use(express.json());
app.use(
  cors({
    origin: 'http://localhost:5173'
  })
);

app.post('/api/scrape', (req, res) => {
  const { adminId, triggerId, templateId } = req.body ?? {};

  if (adminId === undefined || triggerId === undefined || templateId === undefined) {
    return res.status(400).json({
      error: 'Request body must include adminId, triggerId, and templateId.'
    });
  }

  if (parseInt(adminId, 10) !== 1) {
    return res.status(403).json({
      error: 'Access Denied: Scraping capabilities are restricted to the System Super Admin.'
    });
  }

  const scraperProcess = spawn('python', [SCRAPER_SCRIPT, String(triggerId), String(templateId)], {
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
        if (!supabaseAdmin) {
          throw new Error('Supabase server client is not configured.');
        }

        const payload = JSON.parse(outputData.trim());
        const schedules = Array.isArray(payload.schedules) ? payload.schedules : [];

        const rowsToInsert = schedules.map((item) => ({
          template_id: parseInt(templateId, 10),
          mass_type_id: null,
          day_of_week: item.day_of_week,
          start_time: item.start_time,
          end_time: item.end_time,
          language: item.language,
          notes: item.notes,
          is_scraped_draft: true
        }));

        if (rowsToInsert.length > 0) {
          const { error } = await supabaseAdmin
            .from('template_schedules')
            .insert(rowsToInsert);

          if (error) {
            throw error;
          }
        }

        return res.status(200).json({
          success: true,
          message: `Successfully scraped and imported ${schedules.length} schedules as drafts!`
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
        // Continue scanning for a JSON payload line.
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
