#!/bin/sh
set -e

# Claude Code refuses --dangerously-skip-permissions when it runs as root, so
# the server — and every `claude` process it spawns — must be unprivileged.
#
# We still start as root for one reason: /data is a volume. A named volume
# created by an older image, or a bind mount pointing at a host directory, can
# arrive owned by root. Fix that first, then drop privileges for good.

DATA_DIR="${DATA_DIR:-/data}"

if [ "$(id -u)" = '0' ]; then
  mkdir -p "$DATA_DIR/workspaces" "$DATA_DIR/claude-home"

  if [ "$(stat -c '%u' "$DATA_DIR")" != "$(id -u node)" ]; then
    echo "entrypoint: alignement des droits sur $DATA_DIR…"
    # A large restored volume can make this slow, so only recurse when the
    # ownership is actually wrong.
    chown -R node:node "$DATA_DIR"
  fi

  exec gosu node "$@"
fi

# Already unprivileged (docker run --user, or a re-exec): nothing to hand over.
exec "$@"
