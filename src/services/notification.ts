import type { WebClient } from '@slack/web-api';
import { getAllEnvironments } from './environment.js';
import { getState, setState } from '../db/database.js';
import { buildStatusBoard, buildExpirationWarningBlocks, buildExpiredBlocks, buildWaitlistNotificationBlocks } from '../ui/blocks.js';
import type { ReservationWithEnv } from '../types.js';

const STATUS_CHANNEL_KEY = 'status_channel_id';
const STATUS_MESSAGE_TS_KEY = 'status_message_ts';
const STATUS_LAST_REPOST_KEY = 'status_last_repost';
const REPOST_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

async function postNewStatusMessage(client: WebClient, channelId: string, blocks: any[], text: string): Promise<void> {
  const result = await client.chat.postMessage({
    channel: channelId,
    blocks,
    text,
  });
  if (result.ts) {
    setState(STATUS_MESSAGE_TS_KEY, result.ts);
    setState(STATUS_CHANNEL_KEY, channelId);
    setState(STATUS_LAST_REPOST_KEY, String(Date.now()));
  }
}

export async function updateStatusBoard(client: WebClient): Promise<void> {
  const channelId = process.env.STATUS_CHANNEL_ID;
  if (!channelId) return;

  const environments = getAllEnvironments();
  const blocks = buildStatusBoard(environments);
  const text = 'Deploy Environments Status';

  const existingTs = getState(STATUS_MESSAGE_TS_KEY);

  if (existingTs) {
    try {
      await client.chat.update({
        channel: channelId,
        ts: existingTs,
        blocks,
        text,
      });
    } catch (err: any) {
      if (err.data?.error === 'message_not_found') {
        await postNewStatusMessage(client, channelId, blocks, text);
      } else {
        console.error('Failed to update status board:', err.message);
      }
    }
  } else {
    await postNewStatusMessage(client, channelId, blocks, text);
  }
}

/** Delete old message and post a new one so it appears at the bottom */
export async function repostStatusBoard(client: WebClient): Promise<void> {
  const channelId = process.env.STATUS_CHANNEL_ID;
  if (!channelId) return;

  const existingTs = getState(STATUS_MESSAGE_TS_KEY);
  if (existingTs) {
    try {
      await client.chat.delete({ channel: channelId, ts: existingTs });
    } catch {
      // Already deleted — fine
    }
  }

  const environments = getAllEnvironments();
  const blocks = buildStatusBoard(environments);
  await postNewStatusMessage(client, channelId, blocks, 'Deploy Environments Status');
}

/** Check if it's time to repost (called by scheduler) */
export function shouldRepost(): boolean {
  const lastRepost = getState(STATUS_LAST_REPOST_KEY);
  if (!lastRepost) return true;
  return Date.now() - parseInt(lastRepost) >= REPOST_INTERVAL_MS;
}

export async function sendExpirationWarning(client: WebClient, reservation: ReservationWithEnv): Promise<void> {
  try {
    await client.chat.postMessage({
      channel: reservation.user_id,
      blocks: buildExpirationWarningBlocks(reservation.env_name, reservation.expires_at),
      text: `Your reservation of ${reservation.env_name} is about to expire.`,
    });
  } catch (err: any) {
    console.error(`Failed to send expiration warning to ${reservation.user_id}:`, err.message);
  }
}

export async function sendExpiredNotification(client: WebClient, reservation: ReservationWithEnv): Promise<void> {
  try {
    await client.chat.postMessage({
      channel: reservation.user_id,
      blocks: buildExpiredBlocks(reservation.env_name),
      text: `Your reservation of ${reservation.env_name} has expired.`,
    });
  } catch (err: any) {
    console.error(`Failed to send expired notification to ${reservation.user_id}:`, err.message);
  }
}

export async function sendWaitlistNotification(client: WebClient, envName: string, userId: string): Promise<void> {
  try {
    await client.chat.postMessage({
      channel: userId,
      blocks: buildWaitlistNotificationBlocks(envName),
      text: `${envName} is now available!`,
    });
  } catch (err: any) {
    console.error(`Failed to send waitlist notification to ${userId}:`, err.message);
  }
}
