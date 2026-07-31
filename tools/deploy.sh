#!/usr/bin/env bash
# Ship the committed HEAD to a LogHarbor server and prove that it landed.
#
# Every step's exit status is checked and the build output is kept, because the
# failure this guards against is not a deploy that errors out -- it is a deploy
# that breaks while the previous container keeps serving and reporting healthy,
# so a broken deploy and a slow one look identical.
#
# Config (environment):
#   DEPLOY_HOST        ssh target                     (default root@192.168.1.131)
#   DEPLOY_DIR         compose project dir on it      (default /app/logharbor)
#   DEPLOY_URL         base URL as seen ON the server (default http://127.0.0.1:5000)
#   DEPLOY_CONTAINER   container name                 (default logharbor)
#   DEPLOY_IMAGE       image tag                      (default logharbor)
set -euo pipefail

HOST=${DEPLOY_HOST:-root@192.168.1.131}
DIR=${DEPLOY_DIR:-/app/logharbor}
URL=${DEPLOY_URL:-http://127.0.0.1:5000}
CONTAINER=${DEPLOY_CONTAINER:-logharbor}
IMAGE=${DEPLOY_IMAGE:-logharbor}

# Untracked files on the server that are there on purpose. Everything else the
# repo does not track is a leftover from an older deploy and gets removed:
# tar only ever adds, so a file the commit deleted or renamed survives and still
# compiles. A changed extension is the worst case -- useLiveRange.ts -> .tsx left
# the old .ts behind, TypeScript resolved .ts first, and the image was built from
# the previous module while the local build was green.
PROTECTED=(
  docker-compose.yml       # carries the per-host delta, never shipped or removed
  docker-compose.yml.bak   # the pristine repo copy, kept deliberately
  .env
  .deployed-sha
)

ALLOW_DIRTY=0
BUILD=1
LOG="${TMPDIR:-/tmp}/logharbor-deploy-$(date +%Y%m%d-%H%M%S).log"
trap 'rm -f "$LOG.tracked" "$LOG.server"' EXIT

usage() {
  sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
  cat <<'EOF'

Usage: tools/deploy.sh [--allow-dirty] [--no-build]

  --allow-dirty  deploy with uncommitted changes present (they are NOT shipped:
                 git archive ships HEAD, so the deploy would silently lag)
  --no-build     ship and prune only, skip the image rebuild (docs-only changes)
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --allow-dirty) ALLOW_DIRTY=1 ;;
    --no-build)    BUILD=0 ;;
    -h|--help)     usage; exit 0 ;;
    *)             echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

step() { printf '\n==> %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
ok()   { printf '    OK  %s\n' "$*"; }
fail() { printf '\nFAILED: %s\n' "$*" >&2; exit 1; }

remote() { ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" "$@"; }

# eventCount out of /healthz without assuming jq exists on the server.
event_count() {
  remote "curl -fsS $URL/healthz" 2>/dev/null |
    grep -o '"eventCount":[0-9]*' | tr -dc '0-9'
}

# The asset filenames index.html points at -- what a browser actually loads.
asset_refs() { grep -o 'assets/index-[A-Za-z0-9_-]*\.\(js\|css\)' | sort -u; }

# ---------------------------------------------------------------- preflight --

step "Preflight"

git rev-parse --git-dir >/dev/null 2>&1 || fail "not inside a git repository"

if [ -n "$(git status --porcelain)" ]; then
  if [ "$ALLOW_DIRTY" -eq 0 ]; then
    git status --short
    fail "working tree is dirty. git archive ships HEAD, so these changes would
        not reach the server and the deploy would look like it did nothing.
        Commit them, or re-run with --allow-dirty if that is intended."
  fi
  info "working tree is dirty; shipping HEAD anyway (--allow-dirty)"
fi

SHA=$(git rev-parse HEAD)
info "HEAD          $(git log -1 --format='%h %s')"
info "target        $HOST:$DIR"

remote "test -f '$DIR/Dockerfile'" ||
  fail "$DIR on $HOST does not look like a LogHarbor checkout (no Dockerfile)"

PREVIOUS_SHA=$(remote "cat '$DIR/.deployed-sha' 2>/dev/null" || true)
if [ -n "$PREVIOUS_SHA" ]; then
  info "deployed now  ${PREVIOUS_SHA:0:12}"
fi

COUNT_BEFORE=$(event_count || true)
[ -n "$COUNT_BEFORE" ] ||
  fail "cannot read $URL/healthz on $HOST -- refusing to deploy over a server
        whose current state cannot be compared against afterwards"
info "eventCount    $COUNT_BEFORE"

COMPOSE_BEFORE=$(remote "sha256sum '$DIR/docker-compose.yml'" | cut -d' ' -f1)
IMAGE_BEFORE=$(remote "docker image inspect $IMAGE --format '{{.Id}}'" 2>/dev/null || echo none)

# --------------------------------------------------------------------- ship --

step "Ship HEAD"

git archive --format=tar HEAD |
  remote "tar -x -C '$DIR' --exclude=docker-compose.yml" ||
  fail "transfer failed (see the error above); nothing was rebuilt"

COMPOSE_AFTER=$(remote "sha256sum '$DIR/docker-compose.yml'" | cut -d' ' -f1)
[ "$COMPOSE_BEFORE" = "$COMPOSE_AFTER" ] ||
  fail "docker-compose.yml on the server changed during the transfer. It carries
        the per-host delta and must never be overwritten."
ok "$(git ls-tree -r --name-only HEAD | wc -l | tr -d ' ') tracked files, compose delta untouched"

# -------------------------------------------------------------------- prune --

step "Prune files this commit no longer has"

git ls-tree -r --name-only HEAD | LC_ALL=C sort > "$LOG.tracked"
remote "cd '$DIR' && find . -type f \
    -not -path './.git/*' -not -path '*/node_modules/*' \
    -not -path '*/bin/*' -not -path '*/obj/*' -not -path './data/*' \
    | sed 's|^\./||'" | LC_ALL=C sort > "$LOG.server"

# The mirror of the prune: tar reporting success is not proof every file arrived.
MISSING=$(LC_ALL=C comm -23 "$LOG.tracked" "$LOG.server" || true)
[ -z "$MISSING" ] || fail "tracked files the server does not have after the transfer:"$'\n'"$MISSING"

STALE=$(LC_ALL=C comm -13 "$LOG.tracked" "$LOG.server" |
  grep -v -x -F "$(printf '%s\n' "${PROTECTED[@]}")" || true)

if [ -z "$STALE" ]; then
  ok "server tree already matches the commit"
else
  printf '%s\n' "$STALE" | sed 's/^/    - /'
  printf '%s\n' "$STALE" | remote "cd '$DIR' && xargs -d '\n' -r rm -f --" ||
    fail "could not remove the stale files listed above"

  # Trust the removal only after re-reading the server, not after rm's exit code.
  remote "cd '$DIR' && find . -type f \
      -not -path './.git/*' -not -path '*/node_modules/*' \
      -not -path '*/bin/*' -not -path '*/obj/*' -not -path './data/*' \
      | sed 's|^\./||'" | LC_ALL=C sort > "$LOG.server"
  LEFT=$(LC_ALL=C comm -13 "$LOG.tracked" "$LOG.server" |
    grep -v -x -F "$(printf '%s\n' "${PROTECTED[@]}")" || true)
  [ -z "$LEFT" ] || fail "still present after prune:"$'\n'"$LEFT"
  ok "$(printf '%s\n' "$STALE" | wc -l | tr -d ' ') stale files removed"
fi

if [ "$BUILD" -eq 0 ]; then
  remote "printf '%s\n' '$SHA' > '$DIR/.deployed-sha'"
  step "Done (--no-build): source shipped, image left untouched"
  exit 0
fi

# -------------------------------------------------------------------- build --

step "Build (output kept in $LOG)"
info "this takes a couple of minutes; the old container keeps serving until it ends"

set +e
remote "cd '$DIR' && docker compose build" 2>&1 | tee "$LOG"
BUILD_STATUS=${PIPESTATUS[0]}
set -e
[ "$BUILD_STATUS" -eq 0 ] || {
  printf '\n--- last 40 lines of the build ---\n'
  tail -40 "$LOG"
  fail "docker compose build exited $BUILD_STATUS. Full output: $LOG"
}
ok "image built"

step "Start the new container"
set +e
remote "cd '$DIR' && docker compose up -d" 2>&1 | tee -a "$LOG"
UP_STATUS=${PIPESTATUS[0]}
set -e
[ "$UP_STATUS" -eq 0 ] || fail "docker compose up -d exited $UP_STATUS. Output: $LOG"

# ------------------------------------------------------------------- verify --

step "Verify"

IMAGE_AFTER=$(remote "docker image inspect $IMAGE --format '{{.Id}}'")
if [ "$IMAGE_AFTER" = "$IMAGE_BEFORE" ]; then
  info "image unchanged (${IMAGE_AFTER:7:12}) -- fully cached build, no source change"
else
  info "image ${IMAGE_BEFORE:7:12} -> ${IMAGE_AFTER:7:12}"
fi

# The check that catches the failure this script exists for: a build that broke
# leaves the previous container running, healthy, serving the previous code.
RUNNING_IMAGE=$(remote "docker inspect $CONTAINER --format '{{.Image}}'")
[ "$RUNNING_IMAGE" = "$IMAGE_AFTER" ] ||
  fail "$CONTAINER is running image ${RUNNING_IMAGE:7:12}, not the one just built
        (${IMAGE_AFTER:7:12}). The old container is still serving."
ok "container runs the image this build produced"

DEADLINE=$((SECONDS + 120))
while :; do
  HEALTH=$(remote "docker inspect $CONTAINER --format '{{.State.Health.Status}}'" || echo unknown)
  [ "$HEALTH" = "starting" ] || break
  [ "$SECONDS" -lt "$DEADLINE" ] || fail "container still 'starting' after 120s"
  sleep 3
done
[ "$HEALTH" = "healthy" ] || {
  remote "docker logs --tail 40 $CONTAINER" 2>&1 || true
  fail "container health is '$HEALTH'"
}
ok "health healthy"

SERVED=$(remote "curl -fsS $URL/" | asset_refs) ||
  fail "the server does not answer on $URL/"
INSIDE=$(remote "docker exec $CONTAINER cat wwwroot/index.html" | asset_refs) ||
  fail "cannot read wwwroot/index.html out of the running container"
[ -n "$SERVED" ] || fail "no asset references in the served HTML"
[ "$SERVED" = "$INSIDE" ] ||
  fail "served bundle differs from the container's own index.html
        served:    $(echo "$SERVED" | tr '\n' ' ')
        container: $(echo "$INSIDE" | tr '\n' ' ')"
ok "serving $(echo "$SERVED" | tr '\n' ' ')"

COUNT_AFTER=$(event_count || true)
[ -n "$COUNT_AFTER" ] || fail "/healthz unreadable after the deploy"
[ "$COUNT_AFTER" -ge "$COUNT_BEFORE" ] ||
  fail "eventCount dropped $COUNT_BEFORE -> $COUNT_AFTER: the data volume was not preserved"
ok "eventCount $COUNT_BEFORE -> $COUNT_AFTER"

MIGRATIONS=$(remote "docker logs $CONTAINER 2>&1 | grep -i migration | tail -5" || true)
if [ -n "$MIGRATIONS" ]; then
  info "migrations:"
  printf '%s\n' "$MIGRATIONS" | sed 's/^/      /'
fi

remote "printf '%s\n' '$SHA' > '$DIR/.deployed-sha'"

step "Deployed ${SHA:0:12} to $HOST"
