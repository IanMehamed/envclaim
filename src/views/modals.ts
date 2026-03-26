import type { App } from '@slack/bolt';
import { getEnvironmentById, createEnvironment, deleteEnvironment } from '../services/environment.js';
import { claimEnvironment, addDelegate } from '../services/reservation.js';
import { updateStatusBoard } from '../services/notification.js';
import { isAdmin } from '../utils/permissions.js';
import { parseDuration, DEFAULT_DURATION_MS } from '../utils/time.js';

export function registerModalHandlers(app: App): void {
  // Claim modal
  app.view('claim_modal_submit', async ({ ack, body, view, client }) => {
    const envIdStr = view.state.values.env_select_block.env_select.selected_option?.value;
    const durationRaw = view.state.values.duration_block.duration_input.value || '';
    const notes = view.state.values.notes_block.notes_input.value || undefined;
    const delegateUserIds = view.state.values.delegates_block.delegates_select.selected_users || [];
    const userId = body.user.id;

    if (!envIdStr) {
      await ack({
        response_action: 'errors',
        errors: { env_select_block: 'Please select an environment.' },
      });
      return;
    }

    let durationMs: number;
    try {
      durationMs = durationRaw.trim() ? parseDuration(durationRaw) : DEFAULT_DURATION_MS;
    } catch {
      await ack({
        response_action: 'errors',
        errors: { duration_block: 'Invalid duration. Use: 30m, 2h, 1h30m, or a number (minutes).' },
      });
      return;
    }

    const env = getEnvironmentById(parseInt(envIdStr));
    if (!env) {
      await ack({
        response_action: 'errors',
        errors: { env_select_block: 'Environment not found.' },
      });
      return;
    }

    try {
      claimEnvironment(env.name, userId, durationMs, notes);

      for (const delegateId of delegateUserIds) {
        if (delegateId !== userId) {
          try {
            addDelegate(env.name, delegateId, userId);
          } catch {
            // Skip invalid delegates silently
          }
        }
      }

      await ack();
      await updateStatusBoard(client);
    } catch (err) {
      await ack({
        response_action: 'errors',
        errors: { env_select_block: err instanceof Error ? err.message : 'Failed to claim environment.' },
      });
    }
  });

  // Create environment modal
  app.view('create_env_modal_submit', async ({ ack, body, view, client }) => {
    const userId = body.user.id;

    if (!isAdmin(userId)) {
      await ack({
        response_action: 'errors',
        errors: { env_name_block: 'Only admins can create environments.' },
      });
      return;
    }

    const raw = view.state.values.env_name_block.env_name_input.value || '';
    const names = raw.split(/[,\n]+/).map(n => n.trim()).filter(Boolean);

    if (names.length === 0) {
      await ack({
        response_action: 'errors',
        errors: { env_name_block: 'Please enter at least one environment name.' },
      });
      return;
    }

    const errors: string[] = [];
    for (const name of names) {
      try {
        createEnvironment(name, userId);
      } catch (err: any) {
        errors.push(`${name}: ${err.message}`);
      }
    }

    if (errors.length === names.length) {
      await ack({
        response_action: 'errors',
        errors: { env_name_block: errors.join('; ') },
      });
      return;
    }

    await ack();
    await updateStatusBoard(client);
  });

  // Delete environment modal
  app.view('delete_env_modal_submit', async ({ ack, body, view, client }) => {
    const userId = body.user.id;

    if (!isAdmin(userId)) {
      await ack({
        response_action: 'errors',
        errors: { env_delete_block: 'Only admins can delete environments.' },
      });
      return;
    }

    const selectedOptions = view.state.values.env_delete_block.env_delete_select.selected_options || [];
    if (selectedOptions.length === 0) {
      await ack({
        response_action: 'errors',
        errors: { env_delete_block: 'Please select at least one environment.' },
      });
      return;
    }

    const errors: string[] = [];
    for (const option of selectedOptions) {
      const env = getEnvironmentById(parseInt(option.value));
      if (!env) continue;
      try {
        deleteEnvironment(env.name);
      } catch (err: any) {
        errors.push(`${env.name}: ${err.message}`);
      }
    }

    if (errors.length === selectedOptions.length) {
      await ack({
        response_action: 'errors',
        errors: { env_delete_block: errors.join('; ') },
      });
      return;
    }

    await ack();
    await updateStatusBoard(client);
  });
}
