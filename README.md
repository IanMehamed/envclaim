# EnvClaim

A Slack app for coordinating dev/staging environment reservations across teams. No more guessing if an environment is free or pinging people manually.

## Features

- **Status board** — A live-updating message in a Slack channel showing all environments and their status
- **Claim/Release** — Reserve an environment with a duration, release it when done
- **Waitlist** — Queue up for an occupied environment, get notified when it's free
- **Delegates** — Let a teammate release/extend your reservation (e.g., FE dev testing your BE changes)
- **Nudge** — Ask the owner if they're still using an environment
- **Expiration warnings** — DM 5 minutes before your reservation expires
- **Admin controls** — Create/delete environments, manage admin permissions

## Setup

### 1. Create the Slack App

Go to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App** > **From manifest**. Use this JSON:

```json
{
  "display_information": {
    "name": "EnvClaim",
    "description": "Coordinate dev/staging environment reservations"
  },
  "features": {
    "bot_user": {
      "display_name": "EnvClaim",
      "always_online": true
    },
    "slash_commands": [
      {
        "command": "/claim",
        "description": "Manage environment reservations",
        "usage_hint": "status | <env> | release | help",
        "should_escape": false
      }
    ]
  },
  "oauth_config": {
    "scopes": {
      "bot": [
        "chat:write",
        "commands",
        "im:write",
        "pins:write"
      ]
    }
  },
  "settings": {
    "interactivity": {
      "is_enabled": true
    },
    "org_deploy_enabled": false,
    "socket_mode_enabled": true,
    "token_rotation_enabled": false
  }
}
```

### 2. Get your tokens

After creating the app:

1. **App-Level Token**: Basic Information > App-Level Tokens > Generate Token and Scopes > add `connections:write` > Generate. Copy the `xapp-...` token.
2. **Bot Token**: Install App > Install to Workspace > authorize. Copy the `xoxb-...` token.
3. **Signing Secret**: Basic Information > App Credentials > Signing Secret.

### 3. Get Slack IDs

- **Your User ID**: In Slack, click your avatar > Profile > three dots (**...**) > Copy member ID
- **Channel ID**: Create a channel (e.g., `#env-status`), open it, click the channel name at the top > the ID is at the bottom of the details panel

### 4. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env`:

```
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-level-token
SLACK_SIGNING_SECRET=your-signing-secret
STATUS_CHANNEL_ID=C0123456789
INITIAL_ADMIN_USER_ID=U0123456789
DB_PATH=./data/envclaim.db
```

### 5. Invite the app to the channel

In your status channel, type:

```
/invite @EnvClaim
```

**Recommended**: Set the channel to restricted posting (Channel Settings > Posting permissions > Only specific people can post) so only the app posts there.

### 6. Run

#### Development

```bash
npm install
npm run dev
```

#### Docker

```bash
docker compose up --build
```

The app uses Socket Mode (outbound WebSocket), so no ports need to be exposed.

## Usage

### For developers

Run `/claim tutorial` in Slack for a quick guide.

**Common commands:**

| Command | Description |
|---|---|
| `/claim <env> [duration] [notes]` | Reserve an environment |
| `/claim` | Open the claim form (with delegate picker) |
| `/claim release <env>` | Release an environment |
| `/claim extend <env> [duration]` | Extend your reservation |
| `/claim wait <env>` | Join the waitlist |
| `/claim delegate <env> @user` | Let someone release/extend for you |
| `/claim status` | Show all environments |
| `/claim tutorial` | Quick tutorial |
| `/claim help` | Full command reference |

**Duration format:** `15m`, `2h`, `1h30m`, or a bare number (minutes). Default: `1h`.

### For admins

| Command | Description |
|---|---|
| `/claim env create <name>` | Create an environment |
| `/claim env bulk-create a, b, c` | Create multiple environments |
| `/claim env delete <name>` | Delete an environment |
| `/claim env list` | List all environments |
| `/claim admin add @user` | Add an admin |
| `/claim admin remove @user` | Remove an admin |
| `/claim admin list` | List all admins |

Admins can also create/delete environments using the buttons on the status board.

## Architecture

- **Runtime**: Node.js + TypeScript
- **Slack SDK**: Slack Bolt (Socket Mode)
- **Database**: SQLite via better-sqlite3
- **Scheduler**: 30s interval checking for expiring reservations and periodic status board refresh

## Local testing (no Slack needed)

```bash
# Unit tests
npm test

# Interactive CLI
npm run cli
```

The CLI runs against an in-memory database and simulates the full flow:

```
seed                            # Create sample environments
user U_DEV1                     # Switch user
claim dev1/ms-oms 2h testing    # Claim
delegate dev1/ms-oms U_FE_DEV   # Add delegate
status                          # View status board
user U_FE_DEV                   # Switch to delegate
release dev1/ms-oms             # Delegate releases
tick                            # Simulate scheduler
```

## Data

SQLite database is stored at the `DB_PATH` location (default: `./data/envclaim.db`). When running with Docker, data is persisted in a named volume (`bot_data`).
