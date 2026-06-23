import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { templateRepository } from './src/repositories/templateRepository.js';
import { scrapeIngestionService } from './src/services/scrapeIngestionService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const SCRAPER_SCRIPT = path.resolve(__dirname, 'src/scraper/main.py');

app.use(express.json());
app.use(
  cors({
    origin: 'http://localhost:5173'
  })
);

app.post('/api/scrape', async (req, res) => {
  const { adminId, triggerId, templateId, startDate, endDate } = req.body ?? {};

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

  let routingTemplateId = parseInt(templateId, 10);

  if (triggerId === 'st_john_btn') {
    try {
      const stJohnParishId = 12;
      const targetDate = startDate || new Date().toISOString().split('T')[0];
      const activeTemplate = await templateRepository.getActiveTemplateByDate(stJohnParishId, targetDate);
      
      if (activeTemplate) {
        routingTemplateId = activeTemplate.template_id;
      } else {
        const templatesList = await templateRepository.findByAdminId(stJohnParishId);
        if (templatesList && templatesList.length > 0) {
          const defaultTemp = templatesList.find((t) => t.is_default) || templatesList[0];
          routingTemplateId = defaultTemp.template_id;
        } else {
          const defaultTemplate = await templateRepository.createTemplate(
            stJohnParishId,
            "Template 1",
            true,
            startDate || null,
            endDate || null
          );
          if (defaultTemplate) {
            routingTemplateId = defaultTemplate.template_id;
          }
        }
      }
    } catch (err) {
      console.error('[routing lookup failure]', err);
    }
  }

  const scraperProcess = spawn('python', [SCRAPER_SCRIPT, String(triggerId), String(routingTemplateId)], {
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

        if (!payload.start_date) {
          payload.start_date = startDate || null;
        }

        if (!payload.end_date) {
          payload.end_date = endDate || null;
        }

        const schedules = Array.isArray(payload.schedules) ? payload.schedules : [];
        const resolvedStartDate = payload.start_date || null;
        const resolvedEndDate = payload.end_date || null;

        if (resolvedStartDate || resolvedEndDate) {
          await templateRepository.update(routingTemplateId, {
            start_date: resolvedStartDate,
            end_date: resolvedEndDate,
          });
        }

        const ingestionResult = await scrapeIngestionService.replaceDraftSchedules(
          routingTemplateId,
          schedules
        );

        return res.status(200).json({
          success: true,
          message: `Successfully scraped and imported ${ingestionResult.insertedCount} schedules as drafts!`,
          source: payload.source || null,
          schedules: ingestionResult.schedules,
          insertedCount: ingestionResult.insertedCount
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