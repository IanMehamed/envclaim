import readline from 'node:readline';
import { initializeDatabase } from './db/database.js';
import { createEnvironment, deleteEnvironment, getAllEnvironments, listEnvironmentNames } from './services/environment.js';
import { claimEnvironment, releaseEnvironment, extendReservation, expireOverdueReservations, getExpiringReservations, addDelegate, removeDelegate, getDelegates } from './services/reservation.js';
import { joinWaitlist, getNextInWaitlist } from './services/waitlist.js';
import { isAdmin, addAdmin, removeAdmin, listAdmins } from './utils/permissions.js';
import { db } from './db/database.js';
import { parseDuration, formatDuration, DEFAULT_DURATION_MS, WARNING_THRESHOLD_MS } from './utils/time.js';
import type { EnvironmentWithStatus } from './types.js';

// Use in-memory DB for CLI testing
process.env.DB_PATH = ':memory:';
process.env.INITIAL_ADMIN_USER_ID = 'U_ADMIN';

// Re-import to get fresh in-memory DB
import { resetDatabase } from './db/database.js';
resetDatabase();

const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
};

let currentUser = 'U_ADMIN';

function log(msg: string): void {
  console.log(msg);
}

function success(msg: string): void {
  log(`${COLORS.green}✓${COLORS.reset} ${msg}`);
}

function error(msg: string): void {
  log(`${COLORS.red}✗${COLORS.reset} ${msg}`);
}

function info(msg: string): void {
  log(`${COLORS.cyan}ℹ${COLORS.reset} ${msg}`);
}

function dm(userId: string, msg: string): void {
  log(`${COLORS.yellow}📩 DM to ${userId}:${COLORS.reset} ${msg}`);
}

function printStatusBoard(): void {
  const environments = getAllEnvironments();
  log('');
  log(`${COLORS.bold}🚀 Deploy Environments${COLORS.reset}`);
  log('─'.repeat(60));

  if (environments.length === 0) {
    log(`${COLORS.dim}  No environments configured. Use: env create <name>${COLORS.reset}`);
    log('─'.repeat(60));
    return;
  }

  for (const env of environments) {
    const icon = env.reserved_by ? `${COLORS.red}●${COLORS.reset}` : `${COLORS.green}●${COLORS.reset}`;
    log(`  ${icon}  ${COLORS.bold}${env.name}${COLORS.reset}`);

    if (env.reserved_by) {
      const expires = new Date(env.reservation_expires + 'Z');
      const remaining = expires.getTime() - Date.now();
      const remainingStr = remaining > 0 ? formatDuration(remaining) : 'EXPIRED';
      log(`     Reserved by: ${COLORS.cyan}${env.reserved_by}${COLORS.reset}`);
      log(`     Expires: ${expires.toLocaleTimeString()} (${remainingStr} remaining)`);
      if (env.delegates.length > 0) log(`     Delegates: ${COLORS.cyan}${env.delegates.join(', ')}${COLORS.reset}`);
      if (env.notes) log(`     Notes: ${COLORS.dim}${env.notes}${COLORS.reset}`);
      if (env.waitlist_users.length > 0) log(`     Waitlist: ${COLORS.cyan}${env.waitlist_users.map((u, i) => `${i + 1}. ${u}`).join(', ')}${COLORS.reset}`);
    } else {
      log(`     ${COLORS.dim}Available${COLORS.reset}`);
    }
    log('');
  }
  log('─'.repeat(60));
}

function printHelp(): void {
  log(`
${COLORS.bold}EnvClaim CLI — Local Testing Mode${COLORS.reset}

${COLORS.cyan}Current user: ${currentUser}${COLORS.reset}

${COLORS.bold}Reservation Commands:${COLORS.reset}
  status                         Show all environments
  claim <env> [duration] [notes] Reserve an environment
  release <env>                  Release an environment
  extend <env> [duration]        Extend reservation (default: 30m)
  wait <env>                     Join the waitlist
  delegate <env> <user_id>       Let another user release/extend your env
  delegate remove <env> <user_id>  Remove a delegate

${COLORS.bold}Admin Commands:${COLORS.reset}
  env create <name>              Create environment
  env delete <name>              Delete environment
  env list                       List all environments
  admin add <user_id>            Add admin
  admin remove <user_id>         Remove admin
  admin list                     List admins

${COLORS.bold}Testing Commands:${COLORS.reset}
  user <user_id>                 Switch current user
  tick                           Simulate scheduler tick (check expirations)
  expire <env>                   Force-expire a reservation
  seed                           Create sample environments
  whoami                         Show current user

${COLORS.bold}Other:${COLORS.reset}
  help                           Show this help
  exit / quit                    Exit
`);
}

function simulateSchedulerTick(): void {
  info('Running scheduler tick...');

  const expired = expireOverdueReservations();
  for (const r of expired) {
    dm(r.user_id, `Your reservation of ${r.env_name} has expired and been automatically released.`);
    const nextUser = getNextInWaitlist(r.env_id);
    if (nextUser) {
      dm(nextUser, `${r.env_name} is now available! You were next in the waitlist.`);
    }
  }

  const expiring = getExpiringReservations(WARNING_THRESHOLD_MS);
  for (const r of expiring) {
    dm(r.user_id, `Your reservation of ${r.env_name} expires soon. Extend or release it.`);
  }

  if (expired.length === 0 && expiring.length === 0) {
    info('Nothing to process.');
  } else {
    info(`Processed: ${expired.length} expired, ${expiring.length} expiring soon.`);
  }
}

function forceExpire(envName: string): void {
  const env = getAllEnvironments().find(e => e.name === envName);
  if (!env || !env.reserved_by) {
    error(`${envName} is not reserved.`);
    return;
  }
  db.prepare("UPDATE reservations SET expires_at = datetime('now', '-1 minute') WHERE env_id = ? AND status = 'active'").run(env.id);
  success(`Force-expired reservation on ${envName}. Run 'tick' to process.`);
}

function seedEnvironments(): void {
  const envs = ['dev1/ms-oms', 'dev2/ms-ims', 'staging/ms-oms', 'staging/ms-ims'];
  for (const name of envs) {
    try {
      createEnvironment(name, currentUser);
      success(`Created ${name}`);
    } catch (err: any) {
      error(err.message);
    }
  }
}

function handleCommand(input: string): boolean {
  const parts = input.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return true;

  const cmd = parts[0].toLowerCase();

  try {
    switch (cmd) {
      case 'exit':
      case 'quit':
        return false;

      case 'help':
        printHelp();
        break;

      case 'status':
        printStatusBoard();
        break;

      case 'whoami':
        info(`Current user: ${currentUser} (admin: ${isAdmin(currentUser)})`);
        break;

      case 'user':
        if (!parts[1]) {
          error('Usage: user <user_id>');
          break;
        }
        currentUser = parts[1];
        success(`Switched to user: ${currentUser}`);
        break;

      case 'claim': {
        if (!parts[1]) {
          error('Usage: claim <env> [duration] [notes]');
          break;
        }
        const envName = parts[1];
        let durationMs = DEFAULT_DURATION_MS;
        let notesStart = 2;
        if (parts[2]) {
          try {
            durationMs = parseDuration(parts[2]);
            notesStart = 3;
          } catch {
            // not a duration, treat as notes
          }
        }
        const notes = parts.slice(notesStart).join(' ') || undefined;
        claimEnvironment(envName, currentUser, durationMs, notes);
        success(`Claimed ${envName} for ${formatDuration(durationMs)}${notes ? ` — ${notes}` : ''}`);
        break;
      }

      case 'release': {
        if (!parts[1]) {
          error('Usage: release <env>');
          break;
        }
        releaseEnvironment(parts[1], currentUser, isAdmin(currentUser));
        success(`Released ${parts[1]}`);

        const envs = getAllEnvironments();
        const env = envs.find(e => e.name === parts[1]);
        if (env) {
          const nextUser = getNextInWaitlist(env.id);
          if (nextUser) {
            dm(nextUser, `${parts[1]} is now available! You were next in the waitlist.`);
          }
        }
        break;
      }

      case 'extend': {
        if (!parts[1]) {
          error('Usage: extend <env> [duration]');
          break;
        }
        const durationMs = parts[2] ? parseDuration(parts[2]) : 30 * 60 * 1000;
        extendReservation(parts[1], currentUser, durationMs, isAdmin(currentUser));
        success(`Extended ${parts[1]} by ${formatDuration(durationMs)}`);
        break;
      }

      case 'wait': {
        if (!parts[1]) {
          error('Usage: wait <env>');
          break;
        }
        joinWaitlist(parts[1], currentUser);
        success(`Added to waitlist for ${parts[1]}`);
        break;
      }

      case 'delegate': {
        const action = parts[1]?.toLowerCase();
        if (action === 'remove') {
          if (!parts[2] || !parts[3]) { error('Usage: delegate remove <env> <user_id>'); break; }
          removeDelegate(parts[2], parts[3], currentUser, isAdmin(currentUser));
          success(`${parts[3]} is no longer a delegate for ${parts[2]}`);
        } else {
          // delegate <env> <user_id> — shorthand for add
          if (!parts[1] || !parts[2]) { error('Usage: delegate <env> <user_id>'); break; }
          addDelegate(parts[1], parts[2], currentUser, isAdmin(currentUser));
          success(`${parts[2]} can now release/extend ${parts[1]}`);
        }
        break;
      }

      case 'env': {
        const action = parts[1]?.toLowerCase();
        if (action === 'create') {
          if (!parts[2]) { error('Usage: env create <name>'); break; }
          if (!isAdmin(currentUser)) { error('Only admins can manage environments.'); break; }
          createEnvironment(parts[2], currentUser);
          success(`Created environment ${parts[2]}`);
        } else if (action === 'delete') {
          if (!parts[2]) { error('Usage: env delete <name>'); break; }
          if (!isAdmin(currentUser)) { error('Only admins can manage environments.'); break; }
          deleteEnvironment(parts[2]);
          success(`Deleted environment ${parts[2]}`);
        } else if (action === 'list') {
          const names = listEnvironmentNames();
          if (names.length === 0) {
            info('No environments configured.');
          } else {
            log(names.map(n => `  • ${n}`).join('\n'));
          }
        } else {
          error('Usage: env create|delete|list <name>');
        }
        break;
      }

      case 'admin': {
        const action = parts[1]?.toLowerCase();
        if (!isAdmin(currentUser)) { error('Only admins can manage admins.'); break; }
        if (action === 'add') {
          if (!parts[2]) { error('Usage: admin add <user_id>'); break; }
          addAdmin(parts[2], currentUser);
          success(`${parts[2]} is now an admin.`);
        } else if (action === 'remove') {
          if (!parts[2]) { error('Usage: admin remove <user_id>'); break; }
          if (parts[2] === currentUser) { error('Cannot remove yourself.'); break; }
          removeAdmin(parts[2]);
          success(`${parts[2]} is no longer an admin.`);
        } else if (action === 'list') {
          const admins = listAdmins();
          log(admins.map(a => `  • ${a.user_id} (added by ${a.added_by})`).join('\n'));
        } else {
          error('Usage: admin add|remove|list <user_id>');
        }
        break;
      }

      case 'tick':
        simulateSchedulerTick();
        break;

      case 'expire':
        if (!parts[1]) { error('Usage: expire <env>'); break; }
        forceExpire(parts[1]);
        break;

      case 'seed':
        seedEnvironments();
        break;

      default:
        error(`Unknown command: ${cmd}. Type 'help' for usage.`);
    }
  } catch (err: any) {
    error(err.message);
  }

  return true;
}

// Main
log(`${COLORS.bold}EnvClaim CLI — Local Testing Mode${COLORS.reset}`);
log(`${COLORS.dim}Type 'help' for commands, 'exit' to quit.${COLORS.reset}`);
log(`${COLORS.dim}Using in-memory database. Current user: ${currentUser}${COLORS.reset}`);
log('');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(): void {
  rl.question(`${COLORS.cyan}${currentUser}${COLORS.reset} ${COLORS.dim}>${COLORS.reset} `, (answer) => {
    const shouldContinue = handleCommand(answer);
    if (shouldContinue) {
      prompt();
    } else {
      log('Bye!');
      rl.close();
    }
  });
}

prompt();
