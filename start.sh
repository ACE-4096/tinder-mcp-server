#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOKEN_FILE="$HOME/.tinder-mcp-tokens.json"
PID_FILE="$DIR/.server.pid"
PORT=3100

# ── helpers ────────────────────────────────────────────────────────────────
log()  { echo "[tinder-mcp] $*"; }
ok()   { echo "[tinder-mcp] ✓ $*"; }
fail() { echo "[tinder-mcp] ✗ $*" >&2; exit 1; }

server_running() {
  [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

token_valid() {
  # Check env var first (captured from Playwright session)
  local env_token
  env_token=$(grep -E '^TINDER_AUTH_TOKEN=' "$DIR/.env" 2>/dev/null | cut -d= -f2 | tr -d '[:space:]')
  [[ -n "$env_token" ]] && return 0
  # Fallback: check token file
  [[ -f "$TOKEN_FILE" ]] || return 1
  python3 -c "
import json, time, sys
data = json.load(open('$TOKEN_FILE'))
valid = any(v.get('expiresAt', 0) > time.time() * 1000 for v in data.values())
sys.exit(0 if valid else 1)
" 2>/dev/null
}

# ── stop ───────────────────────────────────────────────────────────────────
if [[ "$1" == "stop" ]]; then
  if server_running; then
    kill "$(cat "$PID_FILE")" && rm -f "$PID_FILE"
    ok "Server stopped"
  else
    log "Server not running"
  fi
  exit 0
fi

# ── build if needed ────────────────────────────────────────────────────────
if [[ ! -d "$DIR/dist" ]] || [[ "$DIR/src/index.ts" -nt "$DIR/dist/index.js" ]]; then
  log "Building..."
  cd "$DIR" && npm run build --silent
  ok "Build done"
fi

# ── env ────────────────────────────────────────────────────────────────────
if [[ ! -f "$DIR/.env" ]]; then
  cp "$DIR/.env.example" "$DIR/.env"
  # Generate a random TOKEN_SECRET
  SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  sed -i "s/your-secret-key-here/$SECRET/" "$DIR/.env"
  ok ".env created with random TOKEN_SECRET"
fi

# ── start server ───────────────────────────────────────────────────────────
if server_running; then
  ok "Server already running (pid $(cat "$PID_FILE"))"
else
  log "Starting server on port $PORT..."
  cd "$DIR" && node dist/index.js &> "$DIR/.server.log" &
  echo $! > "$PID_FILE"
  sleep 1
  server_running || fail "Server failed to start — check $DIR/.server.log"
  ok "Server running (pid $(cat "$PID_FILE"))"
fi

# ── auth check ─────────────────────────────────────────────────────────────
if token_valid; then
  ok "Already authenticated — you're good to go"
  exit 0
fi

log "No valid token found — starting SMS auth"
read -rp "  Phone number (e.g. +64221708990): " PHONE

SEND=$(curl -s -X POST "http://localhost:$PORT/mcp/auth/sms/send" \
  -H "Content-Type: application/json" \
  -d "{\"phoneNumber\": \"$PHONE\"}")

if echo "$SEND" | grep -q '"success":true'; then
  ok "OTP sent"
else
  fail "Failed to send OTP: $SEND"
fi

read -rp "  Enter OTP: " OTP

VALIDATE=$(curl -s -X POST "http://localhost:$PORT/mcp/auth/sms/validate" \
  -H "Content-Type: application/json" \
  -d "{\"phoneNumber\": \"$PHONE\", \"otpCode\": \"$OTP\"}")

if echo "$VALIDATE" | grep -q '"status":"authenticated"'; then
  ok "Authenticated — token saved to $TOKEN_FILE"
else
  fail "Auth failed: $VALIDATE"
fi
