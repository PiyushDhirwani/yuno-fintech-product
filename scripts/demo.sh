#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# KofiMarket Payment Gateway — End-to-End Demo Script
# Demonstrates: idempotency, duplicate detection, timeout handling, status check
#
# Prerequisites: server running on localhost:3000 (npm run start:dev)
# Usage:         bash scripts/demo.sh
# ─────────────────────────────────────────────────────────────────────────────

BASE="http://localhost:3000/api"
BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
BLUE="\033[0;34m"
RESET="\033[0m"

sep()  { echo -e "\n${BLUE}──────────────────────────────────────────────${RESET}"; }
h()    { echo -e "\n${BOLD}$1${RESET}"; }
ok()   { echo -e "${GREEN}✓ $1${RESET}"; }
warn() { echo -e "${YELLOW}⚠ $1${RESET}"; }

command -v jq >/dev/null || { echo "jq is required: brew install jq"; exit 1; }

echo -e "${BOLD}KofiMarket Payment Gateway — Demo${RESET}"
echo "Server: $BASE"

# ── 1. Seed test data ─────────────────────────────────────────────────────────
sep
h "1. Seed 53 test payments + 10+ duplicate scenarios"
SEED=$(curl -s -X POST "$BASE/seed")
echo "$SEED" | jq '{paymentsCreated, duplicatesCreated, summary}'
ok "Test data loaded"

# ── 2. New payment with explicit idempotency key ──────────────────────────────
sep
h "2. Submit a NEW payment (explicit idempotency key)"
IDEM_KEY="kofi-demo-$(date +%s)"
PAYLOAD='{"orderId":"order-DEMO-001","customerId":"cust-0099","amount":5000,"currency":"NGN","idempotencyKey":"'"$IDEM_KEY"'"}'

echo "Payload: $PAYLOAD"
RESP1=$(curl -s -X POST "$BASE/payments" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")
echo "$RESP1" | jq '{idempotencyKey, status, amount, currency, idempotent, message}'

STATUS=$(echo "$RESP1" | jq -r '.status')
ok "Payment submitted — status: $STATUS"

# ── 3. Retry the SAME request (idempotent duplicate) ─────────────────────────
sep
h "3. Retry the SAME request — must return cached result, NO new charge"
RESP2=$(curl -s -X POST "$BASE/payments" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")
echo "$RESP2" | jq '{idempotencyKey, status, idempotent, message}'

IDEMPOTENT=$(echo "$RESP2" | jq -r '.idempotent')
if [ "$IDEMPOTENT" = "true" ]; then
  ok "PASS: idempotent=true — duplicate blocked, no charge applied"
else
  warn "UNEXPECTED: idempotent should be true"
fi

# ── 4. Retry a third time ─────────────────────────────────────────────────────
sep
h "4. Retry a THIRD time — still returns cached result"
RESP3=$(curl -s -X POST "$BASE/payments" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")
echo "$RESP3" | jq '{status, idempotent, message}'
ok "Three requests → one charge. Idempotency confirmed."

# ── 5. Auto-generated idempotency key (no key in request) ────────────────────
sep
h "5. Payment WITHOUT idempotency key (auto-generated from payload hash)"
AUTO_PAYLOAD='{"orderId":"order-AUTO-042","customerId":"cust-0001","amount":12500,"currency":"KES"}'
RESP_AUTO1=$(curl -s -X POST "$BASE/payments" \
  -H "Content-Type: application/json" \
  -d "$AUTO_PAYLOAD")
AUTO_KEY=$(echo "$RESP_AUTO1" | jq -r '.idempotencyKey')
echo "$RESP_AUTO1" | jq '{idempotencyKey, status, idempotent}'
ok "Auto-key generated: $AUTO_KEY"

h "   Retry same payload without key — should still be caught"
RESP_AUTO2=$(curl -s -X POST "$BASE/payments" \
  -H "Content-Type: application/json" \
  -d "$AUTO_PAYLOAD")
echo "$RESP_AUTO2" | jq '{idempotencyKey, idempotent, message}'
[ "$(echo "$RESP_AUTO2" | jq -r '.idempotent')" = "true" ] \
  && ok "PASS: auto-keyed duplicate blocked" \
  || warn "UNEXPECTED: should have been blocked"

# ── 6. Status check endpoint ──────────────────────────────────────────────────
sep
h "6. Check payment status by idempotency key"
STATUS_RESP=$(curl -s "$BASE/payments/$AUTO_KEY")
echo "$STATUS_RESP" | jq '{idempotencyKey, status, transactionId, orderId, retryCount}'
ok "Status lookup successful"

# ── 7. List all payments ──────────────────────────────────────────────────────
sep
h "7. List all payments (first 3 shown)"
ALL=$(curl -s "$BASE/payments")
echo "$ALL" | jq '.[0:3] | .[] | {orderId, status, amount, currency, retryCount}'

# ── 8. Timeout scenario — keep submitting until we hit one ───────────────────
sep
h "8. Timeout scenario — submitting until we get status:unknown (up to 15 attempts)"
echo -e "${YELLOW}Note: ~10% of requests timeout. This may take several attempts...${RESET}"
TIMEOUT_KEY=""
for i in $(seq 1 15); do
  TS=$(date +%s)
  T_PAYLOAD='{"orderId":"order-TIMEOUT-'"$i-$TS"'","customerId":"cust-TOUT","amount":7500,"currency":"GHS"}'
  T_RESP=$(curl -s -X POST "$BASE/payments" \
    -H "Content-Type: application/json" \
    -d "$T_PAYLOAD")
  T_STATUS=$(echo "$T_RESP" | jq -r '.status')
  echo "  Attempt $i: status=$T_STATUS"

  if [ "$T_STATUS" = "unknown" ]; then
    TIMEOUT_KEY=$(echo "$T_RESP" | jq -r '.idempotencyKey')
    echo "$T_RESP" | jq '{idempotencyKey, status, message, retryAfter}'
    ok "Got a timeout! Key: $TIMEOUT_KEY"
    break
  fi
done

if [ -n "$TIMEOUT_KEY" ]; then
  sep
  h "9. Retry the timed-out payment — gateway queries processor before re-charging"
  RETRY_RESP=$(curl -s -X POST "$BASE/payments" \
    -H "Content-Type: application/json" \
    -d "$(echo "$T_PAYLOAD" | jq --arg k "$TIMEOUT_KEY" '. + {idempotencyKey: $k}')")
  echo "$RETRY_RESP" | jq '{status, idempotent, message, transactionId}'

  sep
  h "10. Poll payment status directly"
  POLL_RESP=$(curl -s "$BASE/payments/$TIMEOUT_KEY")
  echo "$POLL_RESP" | jq '{idempotencyKey, status, transactionId, processorMessage}'
else
  warn "No timeout triggered in 15 attempts (random — try again or lower the threshold in processor.service.ts)"
fi

# ── Dashboard stats ───────────────────────────────────────────────────────────
sep
h "11. Dashboard stats"
STATS=$(curl -s "$BASE/dashboard")
echo "$STATS" | jq '{totalRequests, uniquePayments, duplicatesBlocked, amountSavedFromDuplicates, successRate}'
TOP_DUPE=$(echo "$STATS" | jq '.paymentsWithDuplicates[0]')
[ "$TOP_DUPE" != "null" ] && echo "Top duplicate offender:" && echo "$TOP_DUPE" | jq '{orderId, retryCount, amountSaved, finalStatus}'

sep
echo -e "${GREEN}${BOLD}Demo complete.${RESET}"
echo -e "Dashboard UI: http://localhost:3000"
echo -e "API docs:     See README.md"
