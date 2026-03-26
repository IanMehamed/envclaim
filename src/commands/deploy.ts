import type { App } from '@slack/bolt';
import { isAdmin } from '../utils/permissions.js';
import { addAdmin, removeAdmin, listAdmins, parseSlackUserId } from '../utils/permissions.js';
import { parseDuration, DEFAULT_DURATION_MS, formatDuration } from '../utils/time.js';
import { createEnvironment, deleteEnvironment, getAllEnvironments, listEnvironmentNames } from '../services/environment.js';
import { claimEnvironment, releaseEnvironment, extendReservation, addDelegate, removeDelegate } from '../services/reservation.js';
import { joinWaitlist } from '../services/waitlist.js';
import { updateStatusBoard } from '../services/notification.js';
import { buildStatusBoard, buildClaimModal, buildHelpBlocks, buildTutorialBlocks } from '../ui/blocks.js';

export function registerDeployCommand(app: App): void {
  app.command('/claim', async ({ command, ack, respond, client }) => {
    await ack();

    const args = command.text.trim().split(/\s+/).filter(Boolean);
    const subcommand = args[0]?.toLowerCase() || 'status';
    const userId = command.user_id;

    try {
      switch (subcommand) {
        case 'status':
          return await handleStatus(respond);

        case 'claim':
          return await handleClaim(args.slice(1), userId, respond, client, command.trigger_id);

        case 'release':
          return await handleRelease(args[1], userId, respond, client);

        case 'extend':
          return await handleExtend(args.slice(1), userId, respond, client);

        case 'wait':
          return await handleWait(args[1], userId, respond, client);

        case 'env':
          return await handleEnvAdmin(args.slice(1), userId, respond, client);

        case 'delegate':
          return await handleDelegate(args.slice(1), userId, respond, client);

        case 'admin':
          return await handleAdminManagement(args.slice(1), userId, respond);

        case 'help':
          return await respond({ response_type: 'ephemeral', blocks: buildHelpBlocks() });

        case 'tutorial':
          return await respond({ response_type: 'ephemeral', blocks: buildTutorialBlocks() });

        default:
          return await respond({
            response_type: 'ephemeral',
            text: `:x: Unknown subcommand: \`${subcommand}\`. Use \`/claim help\` for usage.`,
          });
      }
    } catch (err) {
      console.error(`Command error [${subcommand}]:`, err);
      await respond({
        response_type: 'ephemeral',
        text: `:x: ${err instanceof Error ? err.message : 'Unknown error'}`,
      });
    }
  });
}

async function handleStatus(respond: any): Promise<void> {
  const environments = getAllEnvironments();
  const blocks = buildStatusBoard(environments);
  await respond({ response_type: 'ephemeral', blocks });
}

async function handleClaim(
  args: string[],
  userId: string,
  respond: any,
  client: any,
  triggerId: string
): Promise<void> {
  if (args.length === 0) {
    // Open modal
    const envNames = listEnvironmentNames();
    if (envNames.length === 0) {
      await respond({ response_type: 'ephemeral', text: ':x: No environments configured yet.' });
      return;
    }
    const environments = getAllEnvironments();
    const availableEnvs = environments.map(e => ({ id: e.id, name: e.name, created_by: e.created_by, created_at: e.created_at }));
    await client.views.open({
      trigger_id: triggerId,
      view: buildClaimModal(availableEnvs),
    });
    return;
  }

  const envName = args[0];
  let durationMs = DEFAULT_DURATION_MS;
  let notesStart = 1;

  if (args[1]) {
    try {
      durationMs = parseDuration(args[1]);
      notesStart = 2;
    } catch {
      // Not a valid duration — treat as part of notes
    }
  }

  const notes = args.slice(notesStart).join(' ') || undefined;
  const reservation = claimEnvironment(envName, userId, durationMs, notes);

  await respond({
    response_type: 'ephemeral',
    text: `:white_check_mark: Claimed *${envName}* for ${formatDuration(durationMs)}.${notes ? ` Notes: _${notes}_` : ''}`,
  });

  await updateStatusBoard(client);
}

async function handleRelease(
  envName: string | undefined,
  userId: string,
  respond: any,
  client: any
): Promise<void> {
  if (!envName) {
    await respond({ response_type: 'ephemeral', text: ':x: Usage: `/claim release <env>`' });
    return;
  }

  releaseEnvironment(envName, userId, isAdmin(userId));

  await respond({
    response_type: 'ephemeral',
    text: `:white_check_mark: Released *${envName}*.`,
  });

  // Notify waitlist handled by the release + scheduler, but let's handle it immediately
  const { getEnvironment } = await import('../services/environment.js');
  const { getNextInWaitlist } = await import('../services/waitlist.js');
  const { sendWaitlistNotification } = await import('../services/notification.js');
  const env = getEnvironment(envName);
  if (env) {
    const nextUser = getNextInWaitlist(env.id);
    if (nextUser) {
      await sendWaitlistNotification(client, envName, nextUser);
    }
  }

  await updateStatusBoard(client);
}

async function handleExtend(
  args: string[],
  userId: string,
  respond: any,
  client: any
): Promise<void> {
  const envName = args[0];
  if (!envName) {
    await respond({ response_type: 'ephemeral', text: ':x: Usage: `/claim extend <env> [duration]`' });
    return;
  }

  const durationMs = args[1] ? parseDuration(args[1]) : 30 * 60 * 1000; // default extend 30m
  extendReservation(envName, userId, durationMs, isAdmin(userId));

  await respond({
    response_type: 'ephemeral',
    text: `:white_check_mark: Extended *${envName}* by ${formatDuration(durationMs)}.`,
  });

  await updateStatusBoard(client);
}

async function handleWait(
  envName: string | undefined,
  userId: string,
  respond: any,
  client: any
): Promise<void> {
  if (!envName) {
    await respond({ response_type: 'ephemeral', text: ':x: Usage: `/claim wait <env>`' });
    return;
  }

  joinWaitlist(envName, userId);
  await respond({
    response_type: 'ephemeral',
    text: `:white_check_mark: You've been added to the waitlist for *${envName}*. You'll be notified when it's free.`,
  });

  await updateStatusBoard(client);
}

async function handleDelegate(
  args: string[],
  userId: string,
  respond: any,
  client: any
): Promise<void> {
  const action = args[0]?.toLowerCase();
  const envName = args[1];
  const targetRaw = args[2];

  if (action === 'add' || action === 'remove') {
    if (!envName || !targetRaw) {
      await respond({ response_type: 'ephemeral', text: `:x: Usage: \`/claim delegate ${action} <env> @user\`` });
      return;
    }

    const targetUserId = parseSlackUserId(targetRaw);
    if (!targetUserId) {
      await respond({ response_type: 'ephemeral', text: ':x: Please mention a user with @.' });
      return;
    }

    if (action === 'add') {
      addDelegate(envName, targetUserId, userId, isAdmin(userId));
      await respond({
        response_type: 'ephemeral',
        text: `:white_check_mark: <@${targetUserId}> can now release/extend *${envName}*.`,
      });
    } else {
      removeDelegate(envName, targetUserId, userId, isAdmin(userId));
      await respond({
        response_type: 'ephemeral',
        text: `:white_check_mark: <@${targetUserId}> is no longer a delegate for *${envName}*.`,
      });
    }
    await updateStatusBoard(client);
  } else {
    // Shorthand: /claim delegate <env> @user (defaults to add)
    const shortEnvName = args[0];
    const shortTargetRaw = args[1];

    if (!shortEnvName || !shortTargetRaw) {
      await respond({
        response_type: 'ephemeral',
        text: ':x: Usage: `/claim delegate <env> @user` or `/claim delegate add|remove <env> @user`',
      });
      return;
    }

    const targetUserId = parseSlackUserId(shortTargetRaw);
    if (!targetUserId) {
      await respond({ response_type: 'ephemeral', text: ':x: Please mention a user with @.' });
      return;
    }

    addDelegate(shortEnvName, targetUserId, userId, isAdmin(userId));
    await respond({
      response_type: 'ephemeral',
      text: `:white_check_mark: <@${targetUserId}> can now release/extend *${shortEnvName}*.`,
    });
    await updateStatusBoard(client);
  }
}

async function handleEnvAdmin(
  args: string[],
  userId: string,
  respond: any,
  client: any
): Promise<void> {
  if (!isAdmin(userId)) {
    await respond({ response_type: 'ephemeral', text: ':x: Only admins can manage environments.' });
    return;
  }

  const action = args[0]?.toLowerCase();
  const envName = args[1];

  switch (action) {
    case 'create':
      if (!envName) {
        await respond({ response_type: 'ephemeral', text: ':x: Usage: `/claim env create <name>`' });
        return;
      }
      createEnvironment(envName, userId);
      await respond({
        response_type: 'ephemeral',
        text: `:white_check_mark: Environment *${envName}* created.`,
      });
      await updateStatusBoard(client);
      break;

    case 'delete':
      if (!envName) {
        await respond({ response_type: 'ephemeral', text: ':x: Usage: `/claim env delete <name>`' });
        return;
      }
      deleteEnvironment(envName);
      await respond({
        response_type: 'ephemeral',
        text: `:white_check_mark: Environment *${envName}* deleted.`,
      });
      await updateStatusBoard(client);
      break;

    case 'bulk-create': {
      // /claim env bulk-create name1, name2, name3
      const raw = args.slice(1).join(' ');
      const names = raw.split(/[,\s]+/).map(n => n.trim()).filter(Boolean);
      if (names.length === 0) {
        await respond({ response_type: 'ephemeral', text: ':x: Usage: `/claim env bulk-create name1, name2, name3`' });
        break;
      }
      const results: string[] = [];
      for (const name of names) {
        try {
          createEnvironment(name, userId);
          results.push(`:white_check_mark: *${name}* created`);
        } catch (err: any) {
          results.push(`:x: *${name}*: ${err.message}`);
        }
      }
      await respond({ response_type: 'ephemeral', text: results.join('\n') });
      await updateStatusBoard(client);
      break;
    }

    case 'list': {
      const names = listEnvironmentNames();
      const list = names.length > 0
        ? names.map(n => `• \`${n}\``).join('\n')
        : '_No environments configured._';
      await respond({ response_type: 'ephemeral', text: `*Environments:*\n${list}` });
      break;
    }

    default:
      await respond({
        response_type: 'ephemeral',
        text: ':x: Usage: `/claim env create|delete|bulk-create|list <name>`',
      });
  }
}

async function handleAdminManagement(
  args: string[],
  userId: string,
  respond: any
): Promise<void> {
  if (!isAdmin(userId)) {
    await respond({ response_type: 'ephemeral', text: ':x: Only admins can manage admins.' });
    return;
  }

  const action = args[0]?.toLowerCase();

  switch (action) {
    case 'add': {
      const targetUserId = parseSlackUserId(args[1] || '');
      if (!targetUserId) {
        await respond({ response_type: 'ephemeral', text: ':x: Usage: `/claim admin add @user`' });
        return;
      }
      addAdmin(targetUserId, userId);
      await respond({
        response_type: 'ephemeral',
        text: `:white_check_mark: <@${targetUserId}> is now an admin.`,
      });
      break;
    }

    case 'remove': {
      const targetUserId = parseSlackUserId(args[1] || '');
      if (!targetUserId) {
        await respond({ response_type: 'ephemeral', text: ':x: Usage: `/claim admin remove @user`' });
        return;
      }
      if (targetUserId === userId) {
        await respond({ response_type: 'ephemeral', text: ':x: You cannot remove yourself as admin.' });
        return;
      }
      removeAdmin(targetUserId);
      await respond({
        response_type: 'ephemeral',
        text: `:white_check_mark: <@${targetUserId}> is no longer an admin.`,
      });
      break;
    }

    case 'list': {
      const admins = listAdmins();
      const list = admins.map(a => `• <@${a.user_id}>`).join('\n');
      await respond({ response_type: 'ephemeral', text: `*Admins:*\n${list}` });
      break;
    }

    default:
      await respond({
        response_type: 'ephemeral',
        text: ':x: Usage: `/claim admin add|remove|list @user`',
      });
  }
}
