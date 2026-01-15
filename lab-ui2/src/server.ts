import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDuckDb } from './db.js';
import { ensureUiSchema } from './schema.js';
import { registerApi } from './api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const db = await openDuckDb();
  await ensureUiSchema(db);

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use('/public', express.static(path.join(__dirname, '..', 'public')));

  registerApi(app, db);

  app.get('/', (_req, res) => res.redirect('/strategies'));
  app.get('/strategies', (_req, res) => res.render('strategies'));
  app.get('/strategy-editor', (_req, res) => res.render('strategy-editor'));
  app.get('/strategy-compare', (_req, res) => res.render('strategy-compare'));
  app.get('/optimize', (_req, res) => res.render('optimize'));
  app.get('/optimize-results', (_req, res) => res.render('optimize-results'));
  app.get('/equity', (_req, res) => res.render('equity'));
  app.get('/caller-strategy-matrix', (_req, res) => res.render('caller-strategy-matrix'));
  app.get('/governance', (_req, res) => res.render('governance'));
  app.get('/journal', (_req, res) => res.render('journal'));
  app.get('/runs', (_req, res) => res.render('runs'));
  app.get('/leaderboard', (_req, res) => res.render('leaderboard'));
  // Phase 6 - Truth leaderboard and policies views
  app.get('/truth', (_req, res) => res.render('truth'));
  app.get('/policies', (_req, res) => res.render('policies'));

  const port = Number(process.env.PORT ?? 3111);
  app.listen(port, () => console.log(`[lab-ui] http://localhost:${port}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
