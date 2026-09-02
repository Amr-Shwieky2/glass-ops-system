# Deployment

This document covers running the Glass Operations Management System outside
local development: self-hosting it with Docker Compose (the primary,
always-free path), backing up and restoring its data, and — separately —
what's involved in putting it on a public URL.

For local development (no Docker), see the "Getting started" section in
`README.md`. For the reasoning behind these choices, see `ARCHITECTURE.md`,
section 9 ("Deployment posture").

## 1. Self-hosted via Docker Compose (recommended, always free)

This is the primary way to run the system: Postgres and the application
itself run as containers on a machine the business controls — a server in
the office, a home server, a small VPS, whatever is already available.
There's no account to create, no card to enter, and no usage cap, because
nothing here depends on a third-party service.

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose (the
  `docker compose` CLI plugin, bundled with current Docker Desktop and
  Docker Engine installs).
- Enough disk space on the host for the Postgres data volume, which grows
  with the business's data over time.

### First-time setup

1. **Clone the repository** onto the host machine.

2. **Copy the environment file and fill in Compose-specific values:**

   ```bash
   cp .env.example .env
   ```

   Open `.env` and set the Postgres credentials the Compose stack will use
   (the database user, password, and database name) along with any other
   Compose-specific variables the file calls out. These credentials are
   local to this Docker Compose stack — they are unrelated to any
   credentials used for local (non-Docker) development.

   > **Cross-check needed:** the exact variable names expected here
   > (e.g. `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB`, and how
   > the app's own `DATABASE_URL` is assembled from them) depend on the
   > final `docker-compose.yml` / `Dockerfile`. Match whatever `.env.example`
   > actually documents once that file is in place.

3. **Build the images:**

   ```bash
   docker compose build
   ```

4. **Start the stack in the background:**

   ```bash
   docker compose up -d
   ```

   This starts Postgres (in a named volume, so data survives container
   restarts and rebuilds), the application, and the worker container that
   runs scheduled notification sweeps. Postgres is not exposed to the host
   — the application reaches it only over the Compose-internal network, by
   service name. This is intentional: there's no reason for the database
   port to be reachable from outside the stack in a normal deployment.

5. **Run database migrations**, if this isn't already handled
   automatically on container start:

   ```bash
   docker compose exec app npm run db:migrate
   ```

   > **Cross-check needed:** confirm whether migrations run automatically
   > when the `app` container starts (an entrypoint step) or need this
   > manual command. If they run automatically, this step can be skipped
   > on first setup — but running it by hand is harmless either way,
   > since migrations are idempotent (see "Updating," below).

6. **Seed demo data** — optional, and only useful for a fresh
   evaluation/staging instance, not a real production database with real
   customer data:

   ```bash
   docker compose exec app npm run db:seed
   ```

   This is a deliberate, manual, one-time step. It is never run
   automatically, because it truncates and reseeds tables — running it
   against a database that already holds real business data would destroy
   that data.

7. **Open the application** in a browser at the host machine's address on
   the mapped port, e.g. `http://localhost:<PORT>` if running on the same
   machine you're browsing from, or `http://<host-ip>:<PORT>` from another
   device on the same network.

   > **Cross-check needed:** the actual host port the `app` service is
   > mapped to (the left-hand side of its `ports:` entry in
   > `docker-compose.yml`). Substitute the real value here once known.

### Viewing logs

```bash
docker compose logs -f            # all services
docker compose logs -f app        # just the application
docker compose logs -f postgres   # just the database
```

### Stopping and restarting

```bash
docker compose stop               # stop containers, keep them (and the data volume) around
docker compose start              # start them again
docker compose down               # stop and remove containers (data volume is preserved)
docker compose up -d              # recreate and start
```

`docker compose down -v` additionally deletes the named Postgres volume —
i.e., all data. Don't run this unless that's actually the intent (e.g.
tearing down a disposable test instance). It is not part of the normal
stop/restart/update flow.

### Updating to a new version

```bash
git pull
docker compose build
docker compose up -d
```

This rebuilds the application image from the updated source and recreates
the container. Any new database migrations run automatically and are
idempotent — safe to run again even if some of them already applied — so
there is no separate "migration step" to remember on update, beyond
whatever this repository's own startup behavior already does. The Postgres
data volume is untouched by an update; only the application code changes.

## 2. Backup and restore

Two scripts handle this, both driving the Compose Postgres service
directly — neither touches any non-Docker Postgres install that might also
exist on the host.

### Backing up

```bash
./scripts/backup.sh
```

This runs `pg_dump` inside the running `postgres` Compose service and
writes a timestamped, compressed custom-format dump
(`backups/glass_ops_<timestamp>.dump`) on the host. The stack must be
running (`docker compose up -d`) first. The `backups/` directory is
git-ignored — these files are runtime artifacts, not something to commit —
so treat them as you would any other sensitive data export: store copies
somewhere durable and access-controlled (a separate disk, an encrypted
external drive, a backup service the business already trusts), not only on
the machine that made them.

### Restoring

```bash
./scripts/restore.sh <path-to-backup-file>
```

This is destructive: it drops and recreates every object in the target
database before loading the backup, overwriting whatever is currently
there. The script asks for explicit confirmation before doing anything,
and refuses to run (with a clear error, not a stack trace) if it's called
with the wrong number of arguments or a file path that doesn't exist. Use
it to recover from data loss, or to clone production data into a separate
staging instance for testing.

### Backup cadence

This is guidance, not something either script automates — nothing in this
phase schedules anything on this or any other machine. For a small
business running its own data, a reasonable starting point is a daily
automated backup (e.g. once overnight, outside business hours) plus a
manual backup immediately before anything risky — an update, a schema
change, a bulk data cleanup. A system administrator who owns the host can
wire `scripts/backup.sh` into their own scheduler, for example a cron
entry like:

```cron
0 2 * * * cd /path/to/glass-ops-system && ./scripts/backup.sh >> /var/log/glass-ops-backup.log 2>&1
```

Keeping more than one recent backup (not just the latest) is worth doing
too, since a backup taken after a problem has already occurred is not
useful — a simple rotation (e.g. keep the last 14 daily files, delete
older ones) is enough for most small deployments. None of this is
configured automatically by anything in this repository; it's the host
operator's responsibility to set up.

## 3. A live URL on a free cloud tier

This is a separate, later decision from self-hosting, and this document
does not prescribe or perform one.

Self-hosting (section 1, above) is the recommended default: it's free
indefinitely, requires no third-party account, and keeps the business's
operations data — customers, jobs, financials — entirely under its own
control. A live URL on a hosted platform is worth considering when there's
a specific reason for it (remote access without exposing a home/office
network, wanting someone else to own uptime), but it is optional, and per
`ARCHITECTURE.md` section 9, deliberately not locked into the codebase or
this document as a specific recommendation.

The reason for that is practical, not indecision: free-tier terms at cloud
providers change often enough — limits tightened, card requirements added,
entire free tiers discontinued or restructured — that a specific
recommendation written into this document risks being stale, or even
inaccurate about a provider's current commercial-use terms, by the time
someone reads it. This project already ruled out one popular option for
exactly this reason: Vercel's Hobby plan restricts free use to
non-commercial personal projects, and this system runs a real company's
paid operations data, which Vercel's own terms treat as commercial use
regardless of who is paying for it.

This system's own rule is that **no required third-party service should
ever need a credit card entered for V1 core functionality to work.** Keep
that rule in mind when evaluating any hosting option below — some
providers that offer a genuinely free tier still ask for a card at
sign-up "for verification," which is a different thing from actually
billing it, but is worth knowing about before creating an account.

The following are general categories of provider that have, at various
points, offered something usable for this kind of app — a way to run a
persistent Docker container or Node process, plus either a managed
Postgres database or the ability to run Postgres in a container of its
own. For each, what follows is a candid split between what's reasonably
stable knowledge (the provider exists, and has a track record of offering
something in this shape) and what is not safe to state as current fact
(exact free-tier limits, exact pricing, and — critically — whether a card
is required today). **Verify current terms directly on the provider's own
pricing/free-tier page before creating an account or entering any
information**, exactly as `ARCHITECTURE.md` already recommends doing
before relying on its own Vercel-related notes.

- **Render.** A platform-as-a-service that has historically offered a free
  tier for small web services and, separately, managed Postgres, aimed at
  exactly this kind of small persistent app. Confident: the provider
  exists and has a multi-year history of a free tier aimed at hobby/small
  production use. Not confident, and not stated as current fact here:
  whether its free tier still exists in its historical shape, whether a
  card is required, what the current resource/uptime limits are —
  `ARCHITECTURE.md` itself notes Render's free tier already changed shape
  more than once in the recent past, which is exactly the kind of drift
  this section is warning about.

- **Fly.io.** A platform built around running Docker containers directly
  (a natural fit for a Compose-shaped app, with some translation of the
  compose file into its own deployment config), with the option to run
  Postgres as another app on the same platform, or use an external managed
  Postgres. Confident: the provider exists and is built specifically
  around deploying containers. Not confident: current free-allowance
  details, or whether a card is required at sign-up today.

- **Supabase.** Primarily a managed-Postgres-plus-extras platform (the
  database itself, not app hosting) with a free-tier project offering.
  Would need to be paired with a separate place to run the Next.js
  application itself. Confident: the provider exists and centers on
  hosted Postgres. Not confident: current free-tier limits or database
  size/inactivity-pause behavior, or current card requirements.

- **Oracle Cloud Infrastructure — "Always Free" tier.** A cloud compute
  offering that has, distinctively, marketed a permanently free (not
  time-limited trial) tier of small compute instances, which is enough to
  run a small Docker Compose stack including Postgres directly. Confident:
  this offering has existed and been marketed as "always free" rather than
  a time-limited trial. Not confident, and worth checking carefully given
  this project's no-card rule: OCI sign-up has historically asked for
  card details even for the always-free resources — verify directly
  whether that's still the case and whether it's acceptable given this
  project's hard requirement, before proceeding.

None of the above is a recommendation to use any specific one of these —
it is a starting point for a conversation with whoever owns the hosting
decision, to be had once self-hosting is already working and a live URL
is actually wanted.

**Provisioning any such live deployment requires the business owner's own
account, own decision about which provider (if any) to use, and own
acceptance of that provider's current terms. That step is separate from
this document and is not performed automatically by anything in this
repository.**

## 4. What this system does not need

Worth stating explicitly, since a deployment document is a natural place
to make this verifiable rather than leaving it implicit in scattered code
comments: this system does not require, and V1 core functionality does
not depend on, any of the following paid services —

- No paid mapping/geocoding API.
- No paid SMS or WhatsApp messaging provider.
- No Stripe or other payment processor.
- No required credit card on file anywhere, for any service, to run V1
  core functionality.

Everything the self-hosted deployment path in this document needs —
Postgres, the application runtime, headless Chromium for PDF generation —
is free and open-source, and runs entirely on infrastructure the business
already controls. The only place a credit card could enter the picture at
all is the entirely optional, business-owner-decided live-URL step in
section 3, above, and even there, several of the discussed options have
historically not required one for their free tier.
