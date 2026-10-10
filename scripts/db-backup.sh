#!/usr/bin/env bash
# Local backup of the production database: one pg_dump of the public schema
# in backups/nutribot.dump (gitignored), replaced on every run. Restore with
# pg_restore; see AGENTS.md.
set -euo pipefail

cd "$(dirname "$0")/.."
url="$(grep -E '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '"')"
if [ -z "$url" ]; then
  echo "DATABASE_URL is not set in .env.local" >&2
  exit 1
fi
# pg_dump needs a session connection; 6543 is Supabase's transaction pooler,
# 5432 on the same host is the session pooler.
url="${url/:6543\//:5432/}"

mkdir -p backups
tmp="backups/nutribot.dump.tmp"
pg_dump "$url" --schema=public --format=custom --no-owner --no-privileges --file="$tmp"
# Only replace the previous backup once the new one is complete and readable.
pg_restore --list "$tmp" > /dev/null
mv "$tmp" backups/nutribot.dump
echo "Backed up to backups/nutribot.dump ($(du -h backups/nutribot.dump | cut -f1))"
