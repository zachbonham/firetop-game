# Deploying to Fly.io (M6)

Firetop runs as **one Fly machine** (`firetop-zb`, region `dfw`) with:
- **One volume** (`firetop_data` at `/data`) for the SQLite file.
- **Litestream** streaming every change to the app's own **Tigris bucket**.
- **Daily volume snapshots** from Fly, kept 5 days, as a second safety net.

The setup follows the songbird app's pattern, but Firetop has its own app, volume and bucket. A
Fly volume can't be shared between apps, and a separate bucket keeps each app's backup
credentials and data apart.

## What's in the repo

| File | What it does |
|---|---|
| `Dockerfile` | Build stage: `npm ci`, build the client, then bundle the server with esbuild into one `server.mjs` (engine and Fastify inlined). Runtime stage: Node 24 slim, the bundle, the built client and Litestream. No `node_modules`. |
| `start.sh` | Runs the server under `litestream replicate -exec` when `BUCKET_NAME` is set. Otherwise it runs the server alone, e.g. with a local `docker run`. |
| `litestream.yml` | Replicates `/data/firetop.db` to `s3://$BUCKET_NAME/firetop.db`. A fresh volume restores from the backup on first start. |
| `fly.toml` | One `shared-cpu-1x` / 256 MB machine. The volume is mounted at `/data`, with the `/api/health` check, HTTPS only, and auto stop/start. |
| `.github/workflows/ci.yml` | Typecheck, test and build on every push and pull request. |
| `.github/workflows/deploy.yml` | On push to `main`: CI, then snapshot the volume, `fly deploy`, and check that `/api/health` reports the new commit. Off until the variable `FLY_DEPLOY=true`. |
| `.github/workflows/backup-check.yml` | Weekly: restore the latest backup on the runner and run `integrity_check`. Off until the variable `BACKUP_CHECK=true`. |

In production the server serves the client itself, from the same origin, so `/` is the online
lobby. The local test board is still at `/local`, without autosave.

### Machine stop/start and the turn timer

The machine stops when nobody is connected, so it costs almost nothing while idle. The turn
timer runs inside the server, so while the machine is stopped no turns are timed out. As soon as
any request wakes it (a player opening a game), the server sweeps immediately and applies
deadlines that passed while it slept. A player with a game open keeps the machine awake through
the long-poll.

If timeouts should land on time even when nobody is around, set `min_machines_running = 1` in
`fly.toml`. That keeps the machine running and costs a few dollars a month.

## One-time setup

These are run once, by hand, with your Fly account. They create billable resources, so nothing in
CI does them.

```bash
fly apps create firetop-zb
fly volumes create firetop_data --app firetop-zb --region dfw --size 1
fly storage create --app firetop-zb --name firetop-zb-backups   # sets BUCKET_NAME and the AWS_* secrets on the app
fly deploy --app firetop-zb --build-arg FIRETOP_VERSION=$(git rev-parse --short=7 HEAD)
fly scale count 1 --app firetop-zb                               # exactly one machine (one volume)
curl https://firetop-zb.fly.dev/api/health
```

To deploy from GitHub on every merge:
1. Run `fly tokens create deploy -a firetop-zb`.
2. In the GitHub repo, go to **Settings → Environments → production** and add the token as the
   secret `FLY_API_TOKEN`. You can also require a reviewer to approve each deploy.
3. Go to **Settings → Variables → Actions** and set `FLY_DEPLOY` to `true`.

To turn on the weekly backup drill:
1. Create a **read-only** access key for the `firetop-zb-backups` bucket in the Tigris console.
2. Add these repository secrets: `BACKUP_BUCKET_NAME`, `BACKUP_ENDPOINT_URL_S3`
   (`https://fly.storage.tigris.dev`), `BACKUP_ACCESS_KEY_ID` and `BACKUP_SECRET_ACCESS_KEY`.
3. Set the variable `BACKUP_CHECK` to `true`.

## Day to day

- **Deploy:** merge to `main`, or run `fly deploy` by hand with the `--build-arg` above. Each deploy
  restarts the machine, which takes a few seconds; a page with a game open reconnects by itself.
- **Logs:** `fly logs -a firetop-zb`
- **Rules changes:** a game stored under an older `RULES_VERSION` is refused with 410, not
  replayed differently. Players see "Can't open this game", so finish or abandon running games
  before deploying a rules bump.

## Data retention

The server deletes games that can't change any more, so the database doesn't keep growing. It
checks once an hour and once at startup. A game is deleted with its seats and its action log.
The clock starts at the game's last change (`games.updated_at`): its last action, a seat
claimed, or the start.

| Game | Kept for |
|------|----------|
| Finished or abandoned | 30 days after it ends, so players can still look at the final board and log |
| Waiting for players (never started) | 14 days after the last seat was claimed, or after it was created |
| Stored under another `RULES_VERSION` (refused with 410) | 30 days after its last change, whatever its status |
| Active | Never deleted. The turn timer always ends a stalled game: 3 missed turns removes a player, and a game with no humans left ends as abandoned |

- The windows are `RETENTION_DAYS` in `packages/server/src/games.ts`.
- A deleted game's link answers 404, and the message says that finished games are deleted.
  The game stays in the player's "your games" list until they remove it there.
- SQLite reuses the freed pages, so the file stops growing but doesn't shrink. To shrink it, run
  `VACUUM` by hand (it locks the database while it runs).
- Backups keep deleted games for a while longer: Litestream until its retention window passes,
  and Fly volume snapshots for 5 days.

## Restore

- **Lost or replaced machine or volume:** create a new empty `firetop_data` volume and deploy.
  On first start, Litestream restores `/data/firetop.db` from the bucket
  (`restore-if-db-not-exists`).
- **Bad deploy:** roll back the image with `fly releases` and `fly deploy --image ...`, or restore
  the volume snapshot that the deploy workflow took first:
  1. `fly volumes snapshots list <volume-id>`
  2. `fly volumes create firetop_data --snapshot-id <id> ...`
  3. Attach the new volume and destroy the old one.
- **Test a backup locally:** `litestream restore -config litestream.yml -o restore.db /data/firetop.db`,
  with the bucket's AWS_* variables set.

## Local container check

```bash
docker build --build-arg FIRETOP_VERSION=local -t firetop:local .
docker run --rm -p 3000:3000 -v firetop-data:/data firetop:local   # no BUCKET_NAME: runs without Litestream
```

Podman works the same way: replace `docker` with `podman`.
