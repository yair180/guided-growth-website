# Build Command Center Registry

`/builds-registry.json` is the live source of truth for Build Command Center tabs. Cloudflare Pages serves it at the site root, and the board fetches it every 15 seconds only while the page is visible.

Every entry must contain these fields:

```json
{
  "id": "unique-build-id",
  "title": "Visible build name",
  "feed": "/path-or-url-to-status.json",
  "status": "active"
}
```

`status` is either `active` or `archived`. Active builds render as top-row tabs. Archived builds render under the board's Archive section, where they can still be opened.

## Add a build

1. Add an entry to `builds-registry.json`.
2. Commit and push it to `main`.
3. Cloudflare Pages deploys the change. The visible board picks it up on its next 15-second poll.

An unpublished or unavailable feed is valid. The board shows the build with the honest `no data yet` state until the feed exists.

## Archive or restore a build

This site is static, so the browser cannot write the registry. The Archive and Restore controls state the exact durable change and copy it when the browser allows clipboard access. A conductor session performs the update by changing the entry's `status`, committing, and pushing.

To archive `azure-conductor`, change:

```json
"status": "active"
```

to:

```json
"status": "archived"
```

To restore it, change `archived` back to `active`, commit, and push. No command-center code change is needed for either action.
