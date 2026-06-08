import { JSONFilePreset } from 'lowdb/node';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Low } from 'lowdb';
import type { DatabaseData } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '../../data/db.json');

let db: Low<DatabaseData> | undefined;

export async function initDb() {
  db = await JSONFilePreset<DatabaseData>(DB_PATH, {
    templates: [],
    rundowns: [],
    settings: { display_mode: 'HD1080i50', keyer_mode: 'external', device_index: 0 },
    channels: [],
  });
  console.log('Database initialized:', DB_PATH);
}

export function getDb(): Low<DatabaseData> {
  if (!db) {
    throw new Error('Database was requested before initDb() completed');
  }
  return db;
}
