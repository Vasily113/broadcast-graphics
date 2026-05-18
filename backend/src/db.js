import { JSONFilePreset } from 'lowdb/node';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '../../data/db.json');

let db;

export async function initDb() {
  db = await JSONFilePreset(DB_PATH, { templates: [] });
  console.log('Database initialized:', DB_PATH);
}

export function getDb() {
  return db;
}