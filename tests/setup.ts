import { resetDatabase } from '../src/db/database.js';
import { resetBootstrap } from '../src/utils/permissions.js';

export function setupTestDb(): void {
  resetDatabase();
  resetBootstrap();
}
