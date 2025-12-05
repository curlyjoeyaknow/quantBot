// Standalone script to migrate CSV files to SQLite
import * as path from 'path';
import { migrateAllCSVResults } from '../lib/jobs/migrate-csv-to-sqlite';

// Change to web directory for proper path resolution
process.chdir(path.join(__dirname, '..'));

migrateAllCSVResults()
  .then(() => {
    console.log('Migration completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });

