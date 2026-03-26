import type { KnownBlock } from '@slack/types';
import type { ModalView } from '@slack/types';
import type { EnvironmentWithStatus, Environment } from '../types.js';
import { formatSlackTime, formatDuration, msUntil } from '../utils/time.js';

export function buildStatusBoard(environments: EnvironmentWithStatus[]): KnownBlock[] {
  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: ':rocket: Deploy Environments' },
    },
    { type: 'divider' },
  ];

  if (environments.length === 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '_No environments configured. An admin can create one with `/claim env create <name>`._' },
    });
    return blocks;
  }

  for (const env of environments) {
    const statusEmoji = env.reserved_by ? ':red_circle:' : ':large_green_circle:';

    let detailText: string;
    if (env.reserved_by) {
      const remaining = msUntil(env.reservation_expires!);
      const remainingStr = remaining > 0 ? formatDuration(remaining) : 'expired';
      const lines = [
        `Reserved by <@${env.reserved_by}>`,
        `Expires: ${formatSlackTime(env.reservation_expires!)} (${remainingStr} remaining)`,
      ];
      if (env.delegates.length > 0) lines.push(`Delegates: ${env.delegates.map(d => `<@${d}>`).join(', ')}`);
      if (env.notes) lines.push(`Notes: _${env.notes}_`);
      if (env.waitlist_users.length > 0) {
        const userList = env.waitlist_users.map((u, i) => `${i + 1}. <@${u}>`).join(', ');
        lines.push(`Waitlist: ${userList}`);
      }
      detailText = lines.join('\n');
    } else {
      detailText = '_Available_';
    }

    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `${statusEmoji}  *${env.name}*\n${detailText}` },
      accessory: env.reserved_by
        ? {
            type: 'button',
            text: { type: 'plain_text', text: 'Release' },
            action_id: `release_env_${env.id}`,
            style: 'danger',
            confirm: {
              title: { type: 'plain_text', text: 'Release Environment' },
              text: { type: 'mrkdwn', text: `Release *${env.name}*?` },
              confirm: { type: 'plain_text', text: 'Release' },
              deny: { type: 'plain_text', text: 'Cancel' },
            },
          }
        : {
            type: 'button',
            text: { type: 'plain_text', text: 'Claim' },
            action_id: `claim_env_${env.id}`,
            style: 'primary',
          },
    });

    if (env.reserved_by) {
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Extend 30m' },
            action_id: `extend_env_${env.id}_30`,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Extend 1h' },
            action_id: `extend_env_${env.id}_60`,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Join Waitlist' },
            action_id: `waitlist_env_${env.id}`,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Ask if available' },
            action_id: `nudge_env_${env.id}`,
          },
        ],
      });
    }

    blocks.push({ type: 'divider' });
  }

  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: '+ New Environment' },
        action_id: 'create_env_modal',
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: '- Remove Environment' },
        action_id: 'delete_env_modal',
        style: 'danger',
      },
    ],
  });

  const epoch = Math.floor(Date.now() / 1000);
  blocks.push({
    type: 'context',
    elements: [
      { type: 'mrkdwn', text: `Last updated: <!date^${epoch}^{date_short_pretty} at {time}|${new Date().toISOString()}>` },
    ],
  });

  return blocks;
}

export function buildClaimModal(environments: Environment[], preselectedEnvId?: number): ModalView {
  const options = environments.map(e => ({
    text: { type: 'plain_text' as const, text: e.name },
    value: String(e.id),
  }));

  const initialOption = preselectedEnvId
    ? options.find(o => o.value === String(preselectedEnvId))
    : undefined;

  return {
    type: 'modal',
    callback_id: 'claim_modal_submit',
    title: { type: 'plain_text', text: 'Claim Environment' },
    submit: { type: 'plain_text', text: 'Claim' },
    blocks: [
      {
        type: 'input',
        block_id: 'env_select_block',
        element: {
          type: 'static_select',
          action_id: 'env_select',
          placeholder: { type: 'plain_text', text: 'Select an environment' },
          options,
          ...(initialOption ? { initial_option: initialOption } : {}),
        },
        label: { type: 'plain_text', text: 'Environment' },
      },
      {
        type: 'input',
        block_id: 'duration_block',
        optional: true,
        element: {
          type: 'plain_text_input',
          action_id: 'duration_input',
          initial_value: '1h',
          placeholder: { type: 'plain_text', text: '30m, 2h, 1h30m, 14m...' },
        },
        label: { type: 'plain_text', text: 'Duration' },
        hint: { type: 'plain_text', text: 'Examples: 14m, 2h, 1h30m. Default: 1h' },
      },
      {
        type: 'input',
        block_id: 'notes_block',
        optional: true,
        element: {
          type: 'plain_text_input',
          action_id: 'notes_input',
          placeholder: { type: 'plain_text', text: 'What are you deploying/testing?' },
        },
        label: { type: 'plain_text', text: 'Notes' },
      },
      {
        type: 'input',
        block_id: 'delegates_block',
        optional: true,
        element: {
          type: 'multi_users_select',
          action_id: 'delegates_select',
          placeholder: { type: 'plain_text', text: 'Select users who can release/extend' },
        },
        label: { type: 'plain_text', text: 'Delegates' },
      },
    ],
  };
}

export function buildExpirationWarningBlocks(envName: string, expiresAt: string): KnownBlock[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:warning: Your reservation of *${envName}* expires at ${formatSlackTime(expiresAt)}.\nExtend it or release it to let others use it.`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Extend 30m' },
          action_id: `dm_extend_${envName}_30`,
          style: 'primary',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Extend 1h' },
          action_id: `dm_extend_${envName}_60`,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Release' },
          action_id: `dm_release_${envName}`,
          style: 'danger',
        },
      ],
    },
  ];
}

export function buildExpiredBlocks(envName: string): KnownBlock[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:clock1: Your reservation of *${envName}* has expired and been automatically released.`,
      },
    },
  ];
}

export function buildWaitlistNotificationBlocks(envName: string): KnownBlock[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:tada: *${envName}* is now available! You were next in the waitlist.`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: `Claim ${envName}` },
          action_id: `dm_claim_${envName}`,
          style: 'primary',
        },
      ],
    },
  ];
}

export function buildNudgeBlocks(envName: string, requesterId: string): KnownBlock[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:wave: <@${requesterId}> is asking if *${envName}* is still in use. Are you done with it?`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Release now' },
          action_id: `dm_release_${envName}`,
          style: 'danger',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Still using it' },
          action_id: `nudge_reply_${envName}_${requesterId}`,
        },
      ],
    },
  ];
}

export function buildCreateEnvModal(): ModalView {
  return {
    type: 'modal',
    callback_id: 'create_env_modal_submit',
    title: { type: 'plain_text', text: 'New Environment' },
    submit: { type: 'plain_text', text: 'Create' },
    blocks: [
      {
        type: 'input',
        block_id: 'env_name_block',
        element: {
          type: 'plain_text_input',
          action_id: 'env_name_input',
          placeholder: { type: 'plain_text', text: 'e.g. dev1/ms-oms' },
        },
        label: { type: 'plain_text', text: 'Environment Name' },
        hint: { type: 'plain_text', text: 'Letters, numbers, hyphens, underscores, slashes. Use commas for multiple.' },
      },
    ],
  };
}

export function buildDeleteEnvModal(environments: Environment[]): ModalView {
  const options = environments.map(e => ({
    text: { type: 'plain_text' as const, text: e.name },
    value: String(e.id),
  }));

  return {
    type: 'modal',
    callback_id: 'delete_env_modal_submit',
    title: { type: 'plain_text', text: 'Remove Environments' },
    submit: { type: 'plain_text', text: 'Delete' },
    blocks: [
      {
        type: 'input',
        block_id: 'env_delete_block',
        element: {
          type: 'multi_static_select',
          action_id: 'env_delete_select',
          placeholder: { type: 'plain_text', text: 'Select environments to delete' },
          options,
        },
        label: { type: 'plain_text', text: 'Environments' },
      },
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: ':warning: This will delete the selected environments and all their reservations/waitlists.' },
        ],
      },
    ],
  };
}

export function buildTutorialBlocks(): KnownBlock[] {
  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'EnvClaim - Quick Tutorial' },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          '*What is this?*',
          'Deploy Bot helps the team coordinate who is using which dev/staging environment. No more guessing if an environment is free or pinging people on Slack.',
          '',
          '*How it works:*',
          '1. Check the status board pinned in this channel to see what\'s available',
          '2. Claim an environment before deploying — others will see it\'s taken',
          '3. Release it when you\'re done so others can use it',
          '',
          '*Common commands:*',
          '`/claim claim my-env 1h deploying auth fix` — Reserve for 1 hour with a note',
          '`/claim claim` — Opens a form to pick environment, duration, and delegates',
          '`/claim release my-env` — Free the environment when done',
          '`/claim extend my-env 30m` — Need more time? Extend it',
          '`/claim wait my-env` — Env is taken? Join the waitlist and get notified when it\'s free',
          '`/claim delegate my-env @teammate` — Let a teammate release/extend on your behalf',
          '`/claim status` — See all environments (also visible in the channel)',
          '',
          '*Tips:*',
          '- You\'ll get a DM *5 minutes before* your reservation expires',
          '- Use the *"Ask if available"* button on an occupied env to ping the owner',
          '- Duration supports: `15m`, `2h`, `1h30m`, or just a number like `45` (minutes)',
          '- You can also use the buttons on the status board to claim, extend, or join the waitlist',
        ].join('\n'),
      },
    },
  ];
}

export function buildHelpBlocks(): KnownBlock[] {
  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'EnvClaim - Help' },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          '*Reservation Commands:*',
          '`/claim status` — Show all environments',
          '`/claim claim <env> [duration] [notes]` — Reserve an environment',
          '`/claim claim` — Open claim form',
          '`/claim release <env>` — Release an environment',
          '`/claim extend <env> [duration]` — Extend your reservation',
          '`/claim wait <env>` — Join the waitlist',
          '`/claim delegate <env> @user` — Let someone else release/extend your reservation',
          '`/claim delegate remove <env> @user` — Remove a delegate',
          '',
          '*Admin Commands:*',
          '`/claim env create <name>` — Create a new environment',
          '`/claim env delete <name>` — Delete an environment',
          '`/claim env list` — List all environments',
          '`/claim admin add @user` — Add an admin',
          '`/claim admin remove @user` — Remove an admin',
          '`/claim admin list` — List all admins',
          '',
          '*Duration format:* `30m`, `2h`, `1h30m`, or a number (minutes). Default: 1h.',
        ].join('\n'),
      },
    },
  ];
}
