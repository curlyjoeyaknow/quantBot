/**
 * Handler for `quantbot lab-ui` command
 * Starts the lab UI Express server
 */

import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDuckDb } from '../../lab-ui/db.js';
import { ensureUiSchema } from '../../lab-ui/schema.js';
import { registerApi } from '../../lab-ui/api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const labUiSchema = z.object({
  port: z.number().int().positive().optional(),
});

export type LabUiArgs = z.infer<typeof labUiSchema>;

export async function labUiHandler(args: LabUiArgs, _ctx: CommandContext) {
  const db = await openDuckDb();
  await ensureUiSchema(db);

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', '..', 'lab-ui', 'views'));

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use('/public', express.static(path.join(__dirname, '..', '..', 'lab-ui', 'public')));

  registerApi(app, db);

  app.get('/', (_req, res) => res.redirect('/strategies'));
  app.get('/strategies', (_req, res) => res.render('strategies'));
  app.get('/runs', (_req, res) => res.render('runs'));
  app.get('/leaderboard', (_req, res) => res.render('leaderboard'));
  app.get('/truth', (_req, res) => res.render('truth'));
  app.get('/policies', (_req, res) => res.render('policies'));

  const port = args.port || Number(process.env.PORT ?? 3111);

  return new Promise((resolve) => {
    app.listen(port, () => {
      resolve({
        success: true,
        message: `Lab UI server started on http://localhost:${port}`,
        port,
      });
    });
  });
}
