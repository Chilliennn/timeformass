import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

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

  scraperProcess.stdout.on('data', (chunk) => {
    process.stdout.write(`[scraper stdout] ${chunk.toString()}`);
  });

  scraperProcess.stderr.on('data', (chunk) => {
    process.stderr.write(`[scraper stderr] ${chunk.toString()}`);
  });

  scraperProcess.on('error', (error) => {
    console.error('[scraper error]', error);

    if (!res.headersSent) {
      res.status(500).json({
        error: 'Scraper failed to start.'
      });
    }
  });

  scraperProcess.on('close', (code) => {
    if (res.headersSent) {
      return;
    }

    if (code === 0) {
      return res.status(200).json({
        success: true,
        message: 'Scraper completed sync routine successfully.'
      });
    }

    return res.status(500).json({
      error: `Scraper process exited with code ${code}.`
    });
  });
});

app.listen(PORT, () => {
  console.log(`Local API server running on http://localhost:${PORT}`);
});

export default app;
