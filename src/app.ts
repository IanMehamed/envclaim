import 'dotenv/config';
import { App } from '@slack/bolt';
import { initializeDatabase } from './db/database.js';
import { registerDeployCommand } from './commands/deploy.js';
import { registerButtonActions } from './actions/buttons.js';
import { registerModalHandlers } from './views/modals.js';
import { startScheduler, stopScheduler } from './services/scheduler.js';
import { updateStatusBoard } from './services/notification.js';

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
});

async function main(): Promise<void> {
  initializeDatabase();

  registerDeployCommand(app);
  registerButtonActions(app);
  registerModalHandlers(app);

  await app.start();
  console.log('EnvClaim is running');

  await updateStatusBoard(app.client);
  startScheduler(app.client);
}

function shutdown(): void {
  console.log('Shutting down...');
  stopScheduler();
  app.stop().then(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
