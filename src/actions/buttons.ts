import type { App, BlockElementAction } from '@slack/bolt';
import { getEnvironmentById, getAllEnvironments } from '../services/environment.js';
import { claimEnvironment, releaseEnvironment, extendReservation, getActiveReservation, getDelegates } from '../services/reservation.js';
import { joinWaitlist } from '../services/waitlist.js';
import { getNextInWaitlist } from '../services/waitlist.js';
import { updateStatusBoard, sendWaitlistNotification } from '../services/notification.js';
import { isAdmin } from '../utils/permissions.js';
import { buildClaimModal, buildCreateEnvModal, buildDeleteEnvModal, buildNudgeBlocks } from '../ui/blocks.js';
import { formatDuration } from '../utils/time.js';

export function registerButtonActions(app: App): void {
  // Claim button from status board
  app.action(/^claim_env_(\d+)$/, async ({ action, ack, body, client }) => {
    await ack();
    const envId = parseInt((action as BlockElementAction).action_id.match(/^claim_env_(\d+)$/)![1]);
    const env = getEnvironmentById(envId);
    if (!env) return;

    const allEnvs = getAllEnvironments();
    const envList = allEnvs.map(e => ({ id: e.id, name: e.name, created_by: e.created_by, created_at: e.created_at }));

    await client.views.open({
      trigger_id: (body as any).trigger_id,
      view: buildClaimModal(envList, envId),
    });
  });

  // Release button from status board
  app.action(/^release_env_(\d+)$/, async ({ action, ack, body, client }) => {
    await ack();
    const envId = parseInt((action as BlockElementAction).action_id.match(/^release_env_(\d+)$/)![1]);
    const env = getEnvironmentById(envId);
    if (!env) return;

    const userId = (body as any).user.id;
    try {
      releaseEnvironment(env.name, userId, isAdmin(userId));

      const nextUser = getNextInWaitlist(env.id);
      if (nextUser) {
        await sendWaitlistNotification(client, env.name, nextUser);
      }

      await updateStatusBoard(client);
    } catch (err: any) {
      await client.chat.postEphemeral({
        channel: (body as any).channel?.id || (body as any).user.id,
        user: userId,
        text: `:x: ${err.message}`,
      });
    }
  });

  // Extend buttons from status board (30m or 60m)
  app.action(/^extend_env_(\d+)_(\d+)$/, async ({ action, ack, body, client }) => {
    await ack();
    const match = (action as BlockElementAction).action_id.match(/^extend_env_(\d+)_(\d+)$/)!;
    const envId = parseInt(match[1]);
    const minutes = parseInt(match[2]);
    const env = getEnvironmentById(envId);
    if (!env) return;

    const userId = (body as any).user.id;
    try {
      extendReservation(env.name, userId, minutes * 60 * 1000, isAdmin(userId));
      await updateStatusBoard(client);
    } catch (err: any) {
      await client.chat.postEphemeral({
        channel: (body as any).channel?.id || (body as any).user.id,
        user: userId,
        text: `:x: ${err.message}`,
      });
    }
  });

  // Waitlist button from status board
  app.action(/^waitlist_env_(\d+)$/, async ({ action, ack, body, client }) => {
    await ack();
    const envId = parseInt((action as BlockElementAction).action_id.match(/^waitlist_env_(\d+)$/)![1]);
    const env = getEnvironmentById(envId);
    if (!env) return;

    const userId = (body as any).user.id;
    try {
      joinWaitlist(env.name, userId);
      await client.chat.postEphemeral({
        channel: (body as any).channel?.id || (body as any).user.id,
        user: userId,
        text: `:white_check_mark: You've been added to the waitlist for *${env.name}*.`,
      });
      await updateStatusBoard(client);
    } catch (err: any) {
      await client.chat.postEphemeral({
        channel: (body as any).channel?.id || (body as any).user.id,
        user: userId,
        text: `:x: ${err.message}`,
      });
    }
  });

  // Nudge — ask if environment is still in use
  app.action(/^nudge_env_(\d+)$/, async ({ action, ack, body, client }) => {
    await ack();
    const envId = parseInt((action as BlockElementAction).action_id.match(/^nudge_env_(\d+)$/)![1]);
    const env = getEnvironmentById(envId);
    if (!env) return;

    const userId = (body as any).user.id;
    const reservation = getActiveReservation(env.id);
    if (!reservation) {
      await client.chat.postEphemeral({
        channel: (body as any).channel?.id || userId,
        user: userId,
        text: `:white_check_mark: *${env.name}* is already free! Use \`/claim ${env.name}\` to reserve it.`,
      });
      return;
    }

    if (reservation.user_id === userId) {
      await client.chat.postEphemeral({
        channel: (body as any).channel?.id || userId,
        user: userId,
        text: `:x: You already have this environment reserved.`,
      });
      return;
    }

    // DM the owner
    const nudgeBlocks = buildNudgeBlocks(env.name, userId);
    await client.chat.postMessage({
      channel: reservation.user_id,
      blocks: nudgeBlocks,
      text: `Someone is asking if ${env.name} is still in use.`,
    });

    // DM delegates too
    const delegates = getDelegates(reservation.id);
    for (const delegateId of delegates) {
      await client.chat.postMessage({
        channel: delegateId,
        blocks: nudgeBlocks,
        text: `Someone is asking if ${env.name} is still in use.`,
      });
    }

    await client.chat.postEphemeral({
      channel: (body as any).channel?.id || userId,
      user: userId,
      text: `:white_check_mark: Asked <@${reservation.user_id}>${delegates.length > 0 ? ' and delegates' : ''} if *${env.name}* is still in use.`,
    });
  });

  // Nudge reply — "still using it" notifies the requester
  app.action(/^nudge_reply_(.+)_([A-Z0-9]+)$/, async ({ action, ack, body, client }) => {
    await ack();
    const match = (action as BlockElementAction).action_id.match(/^nudge_reply_(.+)_([A-Z0-9]+)$/)!;
    const envName = match[1];
    const requesterId = match[2];
    const responderId = (body as any).user.id;

    await client.chat.postMessage({
      channel: requesterId,
      text: `:hourglass: <@${responderId}> is still using *${envName}*. You'll be notified when it's free if you're on the waitlist.`,
    });

    await client.chat.postMessage({
      channel: responderId,
      text: `:white_check_mark: Notified <@${requesterId}> that you're still using *${envName}*.`,
    });
  });

  // DM buttons — extend from DM notification
  app.action(/^dm_extend_(.+)_(\d+)$/, async ({ action, ack, body, client }) => {
    await ack();
    const match = (action as BlockElementAction).action_id.match(/^dm_extend_(.+)_(\d+)$/)!;
    const envName = match[1];
    const minutes = parseInt(match[2]);
    const userId = (body as any).user.id;

    try {
      extendReservation(envName, userId, minutes * 60 * 1000);
      await client.chat.postMessage({
        channel: userId,
        text: `:white_check_mark: Extended *${envName}* by ${formatDuration(minutes * 60 * 1000)}.`,
      });
      await updateStatusBoard(client);
    } catch (err: any) {
      await client.chat.postMessage({
        channel: userId,
        text: `:x: ${err.message}`,
      });
    }
  });

  // DM buttons — release from DM notification
  app.action(/^dm_release_(.+)$/, async ({ action, ack, body, client }) => {
    await ack();
    const envName = (action as BlockElementAction).action_id.match(/^dm_release_(.+)$/)![1];
    const userId = (body as any).user.id;

    try {
      releaseEnvironment(envName, userId, isAdmin(userId));
      await client.chat.postMessage({
        channel: userId,
        text: `:white_check_mark: Released *${envName}*.`,
      });

      const { getEnvironment } = await import('../services/environment.js');
      const env = getEnvironment(envName);
      if (env) {
        const nextUser = getNextInWaitlist(env.id);
        if (nextUser) {
          await sendWaitlistNotification(client, envName, nextUser);
        }
      }

      await updateStatusBoard(client);
    } catch (err: any) {
      await client.chat.postMessage({
        channel: userId,
        text: `:x: ${err.message}`,
      });
    }
  });

  // DM buttons — quick claim from waitlist notification
  // Create environment button on status board
  app.action('create_env_modal', async ({ ack, body, client }) => {
    await ack();
    const userId = (body as any).user.id;

    if (!isAdmin(userId)) {
      await client.chat.postEphemeral({
        channel: (body as any).channel?.id || userId,
        user: userId,
        text: ':x: Only admins can create environments.',
      });
      return;
    }

    await client.views.open({
      trigger_id: (body as any).trigger_id,
      view: buildCreateEnvModal(),
    });
  });

  // Delete environment button on status board
  app.action('delete_env_modal', async ({ ack, body, client }) => {
    await ack();
    const userId = (body as any).user.id;

    if (!isAdmin(userId)) {
      await client.chat.postEphemeral({
        channel: (body as any).channel?.id || userId,
        user: userId,
        text: ':x: Only admins can delete environments.',
      });
      return;
    }

    const allEnvs = getAllEnvironments();
    const envList = allEnvs.map(e => ({ id: e.id, name: e.name, created_by: e.created_by, created_at: e.created_at }));

    if (envList.length === 0) {
      await client.chat.postEphemeral({
        channel: (body as any).channel?.id || userId,
        user: userId,
        text: ':x: No environments to delete.',
      });
      return;
    }

    await client.views.open({
      trigger_id: (body as any).trigger_id,
      view: buildDeleteEnvModal(envList),
    });
  });

  app.action(/^dm_claim_(.+)$/, async ({ action, ack, body, client }) => {
    await ack();
    const envName = (action as BlockElementAction).action_id.match(/^dm_claim_(.+)$/)![1];

    const { getEnvironment } = await import('../services/environment.js');
    const env = getEnvironment(envName);
    if (!env) return;

    const allEnvs = getAllEnvironments();
    const envList = allEnvs.map(e => ({ id: e.id, name: e.name, created_by: e.created_by, created_at: e.created_at }));

    await client.views.open({
      trigger_id: (body as any).trigger_id,
      view: buildClaimModal(envList, env.id),
    });
  });
}
