#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

export PATH="/home/subhmx/.bun/bin:$PATH"

# ─── Colors & helpers ──────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${CYAN}▸${NC} $*"; }
ok()    { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
fail()  { echo -e "${RED}✗${NC} $*"; exit 1; }

# ─── 1. Get EC2 public hostname ───────────────────────────────────
info "Detecting public IP..."

# Try IMDSv2 first (token-based)
TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600" 2>/dev/null)
if [ -n "$TOKEN" ]; then
  PUBLIC_HOST=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/public-hostname 2>/dev/null)
  if [ -z "$PUBLIC_HOST" ] || echo "$PUBLIC_HOST" | grep -q "404"; then
    PUBLIC_HOST=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null)
  fi
fi

# Fallback: external service
if [ -z "$PUBLIC_HOST" ] || echo "$PUBLIC_HOST" | grep -q "<"; then
  PUBLIC_HOST=$(curl -s ifconfig.me 2>/dev/null)
fi

# Final fallback: hostname
if [ -z "$PUBLIC_HOST" ]; then
  PUBLIC_HOST=$(hostname -f)
fi

ok "Public host: $PUBLIC_HOST"

# ─── 2. Update .env with PUBLIC_URL ──────────────────────────────
info "Updating .env with PUBLIC_URL..."

if [ ! -f .env ]; then
  cp .env.example .env 2>/dev/null || fail ".env.example not found, cannot create .env"
  warn "Created .env from .env.example — you may need to fill in API keys"
fi

# Update or add PUBLIC_URL
sed -i "s|^PUBLIC_URL=.*|PUBLIC_URL=http://$PUBLIC_HOST:8080|" .env
if ! grep -q "^PUBLIC_URL=" .env; then
  echo "PUBLIC_URL=http://$PUBLIC_HOST:8080" >> .env
fi

# Source .env so our values override any system-level env vars (e.g. DATABASE_URL)
set -a
source .env
set +a

ok "PUBLIC_URL set to http://$PUBLIC_HOST:8080"

# ─── 3. Install dependencies ─────────────────────────────────────
info "Installing dependencies..."
bun install || fail "bun install failed"
ok "Dependencies installed"

# ─── 4. Push DB schema ───────────────────────────────────────────
info "Pushing database schema..."
(cd packages/db && bunx drizzle-kit push) || fail "drizzle-kit push failed"
ok "Database schema pushed"

# ─── 5. Update Twilio webhook ────────────────────────────────────
TWILIO_PHONE_ENCODED=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$TWILIO_PHONE_NUMBER', safe=''))")
WEBHOOK_URL="http://$PUBLIC_HOST:8080/inbound/twiml"

info "Updating Twilio webhook for $TWILIO_PHONE_NUMBER..."
PHONE_SID=$(curl -sf "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/IncomingPhoneNumbers.json?PhoneNumber=$TWILIO_PHONE_ENCODED" \
  -u "$TWILIO_API_KEY_SID:$TWILIO_API_KEY_SECRET" 2>/dev/null | jq -r '.incoming_phone_numbers[0].sid' 2>/dev/null || echo "")

if [ -z "$PHONE_SID" ] || [ "$PHONE_SID" = "null" ]; then
  warn "Could not find Twilio phone SID — skipping webhook update"
else
  curl -sf -X POST "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/IncomingPhoneNumbers/$PHONE_SID.json" \
    -u "$TWILIO_API_KEY_SID:$TWILIO_API_KEY_SECRET" \
    --data-urlencode "VoiceUrl=$WEBHOOK_URL" \
    --data-urlencode "VoiceMethod=POST" > /dev/null \
    && ok "Twilio webhook → $WEBHOOK_URL" \
    || warn "Failed to update Twilio webhook"
fi

# ─── 6. Print summary ────────────────────────────────────────────
echo ""
echo -e "${BOLD}🐝 Bella Insurance Agent - Dev Environment${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "📞 Phone:          ${CYAN}$TWILIO_PHONE_NUMBER${NC}"
echo -e "🌐 WS Server:      ${CYAN}http://$PUBLIC_HOST:8080${NC}"
echo -e "💻 Dashboard:      ${CYAN}http://localhost:3000${NC}"
echo -e "🔗 Twilio Webhook: ${CYAN}$WEBHOOK_URL${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ─── 7. Start servers in parallel ────────────────────────────────
info "Starting servers..."

cleanup() {
  echo ""
  info "Shutting down..."
  kill $WS_PID $WEB_PID 2>/dev/null || true
  wait $WS_PID $WEB_PID 2>/dev/null || true
  ok "Servers stopped"
  exit 0
}
trap cleanup SIGINT SIGTERM

(cd apps/ws-server && bun run dev) &
WS_PID=$!

(cd apps/web && bun run dev) &
WEB_PID=$!

ok "WS server  (PID $WS_PID) starting on :8080"
ok "Web dashboard (PID $WEB_PID) starting on :3000"
echo ""
info "Press Ctrl+C to stop all servers"

wait
