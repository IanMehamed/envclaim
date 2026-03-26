import type { WebClient } from '@slack/web-api';
import { expireOverdueReservations, getExpiringReservations } from './reservation.js';
import { getNextInWaitlist } from './waitlist.js';
import { sendExpirationWarning, sendExpiredNotification, sendWaitlistNotification, updateStatusBoard, repostStatusBoard, shouldRepost } from './notification.js';
import { WARNING_THRESHOLD_MS } from '../utils/time.js';

const warnedReservationIds = new Set<number>();
let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startScheduler(client: WebClient): void {
  intervalHandle = setInterval(async () => {
    try {
      let changed = false;

      // 1. Expire overdue reservations
      const expired = expireOverdueReservations();
      for (const r of expired) {
        await sendExpiredNotification(client, r);
        const nextUser = getNextInWaitlist(r.env_id);
        if (nextUser) {
          await sendWaitlistNotification(client, r.env_name, nextUser);
        }
        warnedReservationIds.delete(r.id);
        changed = true;
      }

      // 2. Warn about soon-to-expire reservations
      const expiring = getExpiringReservations(WARNING_THRESHOLD_MS);
      for (const r of expiring) {
        if (!warnedReservationIds.has(r.id)) {
          await sendExpirationWarning(client, r);
          warnedReservationIds.add(r.id);
        }
      }

      // 3. Update status board if something changed
      if (changed) {
        await updateStatusBoard(client);
      }

      // 4. Periodic repost to push status to bottom of channel
      if (shouldRepost()) {
        await repostStatusBoard(client);
      }
    } catch (err) {
      console.error('Scheduler error:', err);
    }
  }, 30_000);
}

export function stopScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
