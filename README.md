# KofiMarket Idempotent Payment Gateway

A proof-of-concept idempotent payment gateway built to solve KofiMarket's $2.7M/week duplicate-charge problem. Sits between a mobile client and a payment processor, ensuring every payment is processed **exactly once** regardless of network retries.

## Quick Start

**1. Clone and install**
```bash
git clone https://github.com/PiyushDhirwani/yuno-fintech-product
cd yuno-fintech-product
npm install
```

**2. Set environment variables**

Create a `.env` file in the project root (it is gitignored):
```
UPSTASH_REDIS_REST_URL=<your-upstash-rest-url>
UPSTASH_REDIS_REST_TOKEN=<your-upstash-rest-token>
```

Get free credentials at [upstash.com](https://upstash.com) → Create Database → REST API tab.

**3. Start the server**
```bash
npm run start:dev
```

Then open **http://localhost:3000** for the live dashboard.

### Live deployment

The app is deployed at **https://yuno-fintech-product.vercel.app** — the same codebase, running on Vercel serverless with the same Upstash Redis database.

## API Reference

All routes are prefixed with `/api`.

### POST /api/payments — Process a payment

```bash
curl -X POST http://localhost:3000/api/payments \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": "order-12345",
    "customerId": "cust-0042",
    "amount": 5000,
    "currency": "NGN",
    "idempotencyKey": "your-unique-key-here"
  }'
```

**Fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `orderId` | ✅ | Merchant's internal order ID |
| `customerId` | ✅ | Customer identifier |
| `amount` | ✅ | Integer amount in smallest currency unit (e.g. kobo, pesewas) |
| `currency` | ✅ | `GHS`, `NGN`, `KES`, or `XOF` |
| `idempotencyKey` | ❌ | UUID or unique string. Auto-generated if omitted. |

**Responses:**

| HTTP | `status` | Meaning |
|------|----------|---------|
| 200 | `approved` / `declined` | Payment has a final outcome |
| 200 + `idempotent: true` | any | Duplicate detected — cached result returned, no charge |
| 202 | `unknown` | Processor timed out — retry with same key |

**Example — successful new payment:**
```json
{
  "idempotencyKey": "kofi-abc123",
  "transactionId": "txn-a1b2c3-1717600000000",
  "status": "approved",
  "amount": 5000,
  "currency": "NGN",
  "idempotent": false,
  "message": "Payment processed successfully."
}
```

**Example — duplicate blocked:**
```json
{
  "idempotencyKey": "kofi-abc123",
  "transactionId": "txn-a1b2c3-1717600000000",
  "status": "approved",
  "idempotent": true,
  "message": "Duplicate request detected. Returning cached result — no charge applied."
}
```

**Example — timeout:**
```json
{
  "idempotencyKey": "kofi-abc123",
  "status": "unknown",
  "idempotent": false,
  "message": "Payment processor timed out. Use the same idempotency key to retry.",
  "retryAfter": 5
}
```

---

### GET /api/payments/:key — Check payment status

```bash
curl http://localhost:3000/api/payments/kofi-abc123
```

If the payment previously timed out (`status: unknown`), this endpoint attempts a live processor status query before responding. The record is updated in-place if resolved.

---

### GET /api/payments — List all payments

```bash
curl http://localhost:3000/api/payments
```

Returns all payment records sorted by most recent first.

---

### GET /api/dashboard — Duplicate prevention stats

```bash
curl http://localhost:3000/api/dashboard
```

Returns:
- `totalRequests` — all requests including retries
- `duplicatesBlocked` — number of duplicate charges prevented
- `amountSavedFromDuplicates` — total amount not double-charged
- `successRate` — % of unique payments that were approved
- `byStatus` / `byCurrency` — breakdowns
- `paymentsWithDuplicates` — top duplicate offenders (for the dashboard table)

---

### POST /api/seed — Load test data

```bash
curl -X POST http://localhost:3000/api/seed
```

Clears the store and populates it with:
- 50 standard payments (≈70% approved / 20% declined / 10% unknown)
- 3 edge cases (max amount, min amount, pending timeout)
- 10–40 duplicate attempts across 13 of the payment records

---

### DELETE /api/dashboard/clear — Wipe all data

```bash
curl -X DELETE http://localhost:3000/api/dashboard/clear
```

---

## Running the Demo Script

```bash
bash scripts/demo.sh
```

The script walks through all key scenarios in sequence:
1. Seed test data
2. Submit a new payment
3. Retry the same request (idempotency check)
4. Retry a third time
5. Payment without an idempotency key (auto-generated)
6. Check status by key
7. Force a timeout and retry it
8. Dashboard stats

Requires `jq` (`brew install jq`).

---

## Architecture & Design Decisions

### Idempotency Key Generation

If the client doesn't supply an `idempotencyKey`, one is generated automatically:

```
key = SHA-256( orderId + ":" + customerId + ":" + amount + ":" + currency )
      truncated to 32 hex characters
```

This is a **deterministic hash** — the same business intent always maps to the same key, so duplicate requests are caught even when the client never heard of idempotency keys. The tradeoff: if a customer legitimately wants to buy the same item twice (same amount, same order structure), they must supply distinct order IDs. This matches real payment API behaviour (Stripe, Paystack).

### Duplicate Detection

On every `POST /api/payments`:

1. Resolve the idempotency key (client-supplied or auto-generated)
2. Look up the key in the store
3. If **found with a final status** → return the cached response, record a `DuplicateAttempt`, increment `retryCount`. No processor call.
4. If **found with `status: unknown`** (previous timeout) → query the processor for resolution before returning
5. If **not found** → write a `processing` record first (concurrency guard), then call the processor

Writing `processing` before the async processor call prevents a race condition where two concurrent requests for the same key both see "not found" and both submit to the processor.

### Timeout Handling

The simulated processor times out ~10% of the time (configurable in `processor.service.ts`). When it does:

1. The payment record is stored with `status: unknown`
2. The client receives HTTP 202 with `retryAfter: 5` seconds
3. When the client retries with the same key, the gateway calls `queryTransactionStatus()` on the processor
4. If resolved → update the record and return the final status (no duplicate charge)
5. If still unresolved → return 202 again with a longer `retryAfter`
6. The `GET /api/payments/:key` endpoint also performs this live resolution on demand

### Storage

Payments are stored in **[Upstash Redis](https://upstash.com)** (serverless Redis over REST). Each payment is a JSON value at `payment:{idempotencyKey}`; a Redis Set at `payments:index` tracks all keys for listing. Duplicate-attempt arrays live at `duplicates:{key}`.

Using Redis means data is shared across every serverless Lambda instance on Vercel and survives cold starts — something that was impossible with the previous per-instance file approach.

For local development, the same Upstash database is used (credentials in `.env`). To swap storage backends, only `StoreService` needs changing — the interface is eight methods: `getPayment`, `setPayment`, `updatePayment`, `recordDuplicate`, `getAllPayments`, `clear`, `getStats`.

### Project Structure

```
src/
├── types/payment.types.ts      # Shared TypeScript types
├── store/                      # StoreService — in-memory + file persistence
├── processor/                  # ProcessorService — simulated payment processor
├── payments/                   # Core idempotency logic + REST controller
│   ├── dto/create-payment.dto.ts
│   ├── payments.service.ts
│   └── payments.controller.ts
├── dashboard/                  # Stats endpoint + clear endpoint
├── seed/                       # Test data generator
└── main.ts                     # Bootstrap: global prefix /api, ValidationPipe
public/
└── index.html                  # Live dashboard UI (Tailwind CDN, vanilla JS)
scripts/
└── demo.sh                     # cURL demo script covering all scenarios
data/
└── payments.json               # Auto-created; persists between server restarts
```

### Vercel Deployment

```bash
npm install -g vercel
vercel
```

Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in the Vercel project's Environment Variables dashboard before deploying. The included `vercel.json` runs `nest build`, bundles the output, and routes all `/api/*` traffic to the compiled NestJS handler. The `public/` folder is served as static CDN assets.

---

## Test Scenarios

| Scenario | How to trigger |
|----------|---------------|
| Duplicate detection | Submit same request twice with the same `idempotencyKey` |
| Auto-key deduplication | Omit `idempotencyKey`; submit same payload twice |
| Timeout | Keep submitting new payments until you get `status: unknown` (~1 in 10) |
| Timeout retry | Retry a timed-out payment with the same key |
| Status check | `GET /api/payments/:key` on any payment |
| Edge case: huge amount | Seed data includes a 9,999,999 NGN payment |
| Edge case: zero-ish | Seed data includes a 1 GHS payment |

## Currencies Supported

| Code | Country | Typical range |
|------|---------|---------------|
| NGN | Nigeria | 5,000 – 50,000 |
| GHS | Ghana | 500 – 10,000 |
| KES | Kenya | 1,000 – 20,000 |
| XOF | Côte d'Ivoire | 2,000 – 30,000 |
