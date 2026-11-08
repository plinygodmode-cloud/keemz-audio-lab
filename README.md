# KEEMZ AUDIO LAB — 2.0

A premium, Vercel-ready audio production site: a cinematic Three.js hero, a filterable audio
portfolio, a server-authoritative sample store, Paymob-hosted payments, verified callbacks,
private Cloudflare R2 delivery, and a real Resend-backed inquiry system.

Nothing in this repository invents content. Tracks, social links, products, prices and contact
details are yours to configure — the UI stays honest (and good-looking) until you do.

---

## 1. What changed in 2.0

The original code was a solid skeleton with a genuine security-minded start. This release keeps
its visual identity and structure, fixes the things that would have failed in production, and
extends the experience. Everything below was verified in the repository, not guessed.

### Bugs found and fixed

| # | Where | Problem found | Fix |
|---|-------|---------------|-----|
| 1 | `api/checkout.js` | **Checkout could never work.** The browser was sent to `https://accept.paymob.com/unifiedcheckout/?publicKey=…`, which is not a valid Paymob endpoint. Paymob's current spec is `https://eg.checkout.paymob.com/?publicKey=&clientSecret=`. | Region-aware `PAYMOB_CHECKOUT_URL` builder (`eg/ksa/uae/om.checkout.paymob.com`), with tests asserting the host. |
| 2 | `api/paymob-webhook.js` | Orders existed only as an HMAC blob inside Paymob's `extras`. If Paymob did not echo `payment_key_claims.extra.order_data` (its documented examples show `extra: {}`), **every payment would fail to fulfil**. The reference was also 101 characters long, at risk of truncation by `special_reference`. | Orders are now persisted at checkout time and looked up by a 28-character reference (`KAL-` + 24 hex). `extras` remains only as a signed legacy fallback. |
| 3 | `api/paymob-webhook.js` | Duplicate-callback protection relied only on Resend's idempotency key (24 h window), so a retry after that window delivered twice. | Atomic, store-backed claim per transaction id (14-day TTL) using `SET NX`; concurrency-safe. |
| 4 | `api/paymob-webhook.js` | `pending` transactions were treated as failures and marked the order failed. | Pending transactions now leave the order open and never deliver. |
| 5 | `api/checkout.js` | No readiness gate: a payment could be taken while email/R2 were misconfigured, leaving a paying customer with no files. | Checkout refuses to start unless payment **and** delivery (Resend + R2 + order store) are all configured. |
| 6 | `api/checkout.js` | Paymob error text ("check your integration ID, currency and test/live keys") was returned to the browser. | Operator detail is logged server-side; customers get actionable, non-leaky messages. |
| 7 | `api/contact.js` | No rate limiting — a trivially abusable Resend endpoint. Over-length messages passed validation after being truncated. | Burst + hourly per-IP limits, optional Turnstile, service allowlist, pre-truncation length checks. |
| 8 | `api/contact.js` | `service` was a free-text field, so any string (or newline) reached the email subject. | Allowlisted services only; subject sanitised to a single line. |
| 9 | `api/download.js` | Download links were valid for anyone holding them, with no re-check that the order was still paid, and no filename/`Content-Disposition` on the R2 object. | The endpoint re-reads the order (paid + product belongs to it), then signs a 120 s R2 URL with `response-content-disposition`. Revoking an order kills its links. |
| 10 | `assets/app.js` | Three.js was loaded from `cdnjs…/three.min.js`, a build three.js deprecated at r150 and ships only as a deprecated stub. One CDN outage (or removal) and the hero silently degraded forever. | three.js r160 is vendored, tree-shaken to the 13 classes the scene uses (`assets/vendor`, 475 KB → 120 KB gzip), with its MIT licence. |
| 11 | `assets/app.js` | The portfolio player had play/stop only: no progress, no seek, no duration, no error state; a broken MP3 failed silently. | Full custom player: progress + seek (keyboard accessible), time display, single-audio arbitration, explicit load-failure messaging. |
| 12 | `assets/app.js` | Store/catalogue failures rendered "the sample vault is being stocked", i.e. an outage looked like an empty shop. | Distinct loading / error (with retry) / genuinely-empty states. |
| 13 | `assets/app.js` | Empty states exposed internal instructions ("Add your tracks to assets/site-config.js") to visitors. | Public-facing empty states now offer a real next step (request a listening link, commission a pack); config hints only live in this README. |
| 14 | `assets/app.js` | Cart totals could desync from the catalogue; no per-line subtotal; checkout did not show what was being bought. | Catalogue reconciliation, line totals, order summary in the checkout modal, currency-aware formatting. |
| 15 | `assets/app.js` | No focus management for the bag/checkout overlays, no skip link, no scroll-spy, no `aria-live` updates. | Focus trap + focus restore, Escape handling, skip link, `aria-current` scroll-spy, live regions, 44 px targets. |
| 16 | `index.html` | No canonical, OG image, Twitter card, favicon, structured data, `noscript`, or 404 page. | Added, plus JSON-LD, `sitemap.xml`, `robots.txt`, branded OG image, SVG favicon, apple-touch icon. |
| 17 | `vercel.json` | No CSP, no HSTS, no cache policy for fonts/assets; `X-Frame-Options: SAMEORIGIN` blocked preview embedding. | Strict CSP (script-src 'self'), HSTS, COOP, asset caching, frame headers removed deliberately (see §11). |
| 18 | `api/*` | Three different error/response conventions (JSON here, plain text there). | Shared `lib/http.js` envelopes, consistent status codes, `Allow` headers. |

### Enhancements

- **Visual system:** refined hero with a floating studio panel and CSS orbit field, editorial type
  scale, capability ticker, glassmorphism surfaces, pointer-driven 3D card tilt (disabled for touch
  and reduced motion), cinematic section reveals, richer player and store cards, mobile-first
  breakpoints down to 320 px.
- **Portfolio:** categories, live search, featured-first ordering, artwork, BPM/genre/key badges,
  native previews, provider embeds opened on demand (so nothing third-party loads until asked).
- **Store:** server-priced catalogue, per-pack previews, contents list, licence label, compare-at
  pricing, quantity limits, empty/error/loading states, order summary.
- **Operations:** `/api/health` readiness report, `/api/order-status` (status + "email me the links
  again"), `/payment-return` page driven by verified server state, `lib/` shared modules,
  56 automated tests, `npm run check` static audit, zero-dependency dev server.

---

## 2. Architecture

```
index.html              main one-page site
licensing.html          licence terms (edit to match your rights)
payment-return.html     status page after Paymob redirect (no fulfilment here)
404.html                branded not-found page
assets/
  style.css             design system + components
  pages.css             secondary page layout
  app.js                portfolio, player, store, cart, checkout, contact
  scene.js              Three.js scene (ES module)
  site-config.js        ALL public content (yours to edit)
  return.js, pages.js   small page controllers
  fonts/                self-hosted Syne + DM Mono (SIL OFL)
  vendor/               three.js r160 tree-shaken build + MIT licence
  img/                  favicon, apple-touch-icon, og.jpg
api/
  catalog.js            GET  public product feed (prices are informational)
  checkout.js           POST validate cart → persist order → Paymob intention
  paymob-webhook.js     POST verify HMAC → reconcile → deliver once
  download.js           GET  verify token → re-check order → 302 signed R2 URL
  order-status.js       GET  order status · POST resend delivery email
  contact.js            POST validated inquiry → Resend
  health.js             GET  readiness report
lib/
  config.js             environment reading, readiness, region mapping
  security.js           constant-time compare, HMAC tokens, origin checks, IP
  orders.js             order model, payment matching, download links
  store.js              order store + idempotency claims + rate limiting
  catalog.js            validation of PRODUCTS_JSON (single price authority)
  paymob.js             intention API, official 20-field HMAC, checkout URL
  email.js              Resend client + responsive HTML templates
  turnstile.js          optional Cloudflare spam check
  http.js, util.js      request/response helpers, escaping, validation
tests/                  56 node:test cases (no network, no credentials)
scripts/dev-server.js   local server that runs the real handlers
scripts/check.js        syntax/JSON/link/secret-exposure audit
```

### Payment lifecycle

```
browser ──POST /api/checkout {items, customer}──► server
                                                   │ 1. validate + price from env
                                                   │ 2. persist order (status=created)
                                                   │ 3. POST /v1/intention/ (secret key)
                                                   ◄─ {checkoutUrl: eg.checkout.paymob.com?…}
browser → Paymob hosted checkout → card/wallet

Paymob ──POST /api/paymob-webhook?hmac=…──► server
                                             1. HMAC-SHA512 over 20 fields
                                             2. load order by merchant_order_id
                                             3. compare amount + currency + items
                                             4. claim transaction (SET NX, once)
                                             5. sign download links → Resend
                                             6. order.status = paid

browser ← redirect → /payment-return?ref=…&t=…  (signed token)
        └─ GET /api/order-status ─► shows the stored status, offers a resend

customer ──GET /api/download?token=…──► verify HMAC + expiry
                                        re-check order paid + product
                                        302 → R2 signed URL (120 s)
```

---

## 3. Local setup

Requires Node.js 20+ (tested on 22).

```bash
npm install
cp .env.example .env.local     # optional for design work; required for checkout
npm run dev                    # http://localhost:3000
```

`npm run dev` runs `scripts/dev-server.js`: static files, `cleanUrls`, and the real `api/*`
handlers with `.env.local` loaded. No Vercel login required. If you prefer the real Vercel
runtime, `npm run dev:vercel` (requires `vercel login`).

Without environment variables the site runs fully: hero, 3D scene, portfolio, services, contact
validation. The store shows its empty state and checkout is disabled — by design.

---

## 4. Add your content

Everything public lives in **`assets/site-config.js`**.

**Channels**

```js
socials: { instagram: 'https://instagram.com/…', soundcloud: '…', spotify: '…', youtube: '…' },
featured: { soundcloud: 'https://soundcloud.com/you/sets/release', spotify: '', youtube: '' }
```

Empty values are never rendered — no dead links.

**Portfolio** (`tracks: []`) — each entry supports:

```js
{
  title: 'Night Shift',
  category: 'Beats',                    // becomes a filter chip
  type: 'audio',                        // 'audio' | 'soundcloud' | 'spotify' | 'youtube'
  src: '/audio/night-shift-preview.mp3',// same-origin path for audio, provider URL otherwise
  note: 'Drill · 142 BPM · C minor',
  bpm: 142, genre: 'Drill', key: 'Cm',
  artwork: '/assets/img/night-shift.jpg',
  featured: true,
  description: 'Built from a single Rhodes loop and a resampled drum bus.'
}
```

Put previews in `audio/` at the project root so `/audio/…` resolves on Vercel. Only upload
previews you are happy to make public. The player shows a real error if a file is missing, so
test each URL once after deploying.

**Services** drive the service grid and the "Start an inquiry" prefill; `inquiry` must match an
option in `inquiryOptions` (or in `CONTACT_SERVICES`).

**Contact details** — `contactEmail` and `whatsapp` are validated before rendering; a WhatsApp
link only appears with a real number in international format.

**Availability & response time** — `availability` ("Taking briefs") and `responseTime`
("Reply within 1–2 business days") are promises shown to visitors. Set either to `""` to hide it,
or edit it to match what you can actually commit to.

---

## 5. Sample store

Products are **server-side only** (`PRODUCTS_JSON`), so the browser cannot influence a price.

```json
[
  {
    "id": "drill-essentials",
    "name": "Drill Essentials",
    "description": "Twelve construction kits built around Cairo drill.",
    "priceMinor": 25000,
    "currency": "EGP",
    "active": true,
    "tags": ["WAV", "MIDI"],
    "format": "WAV + MIDI",
    "glyph": "◈",
    "image": "/assets/img/drill-essentials.jpg",
    "previewUrl": "/audio/drill-essentials-preview.mp3",
    "contents": ["12 construction kits", "40 one-shots", "MIDI stems"],
    "licence": "Standard licence",
    "bpm": 142,
    "genre": "Drill"
  }
]
```

| Field | Required | Notes |
|-------|----------|-------|
| `id` | yes | `[a-z0-9-_]`, max 64 chars, unique |
| `name` | yes | shown on the card |
| `priceMinor` | yes | integer, smallest unit (`25000` = EGP 250.00) |
| `currency` | yes | must equal `PAYMOB_CURRENCY` or the pack is hidden |
| `active` | yes | must be `true` to publish |
| `image`, `previewUrl` | no | **same-origin paths only** (no hotlinks) |
| `contents`, `tags`, `format`, `glyph`, `licence`, `bpm`, `genre`, `compareAtMinor` | no | presentation only |

A product is published only if it is `active`, priced, currency-matching **and** has an entry in
`DOWNLOAD_OBJECTS_JSON` — an undeliverable pack can never be sold.

Upload the ZIPs to a **private** R2 bucket (never the website folder):

```bash
npx wrangler r2 object put "kal-private/packs/drill-essentials.zip" \
  --file ./dist/drill-essentials.zip --content-type application/zip
```

```json
DOWNLOAD_OBJECTS_JSON={"drill-essentials":"packs/drill-essentials.zip"}
```

R2 bucket setup: create the bucket, create an R2 API token with **Object Read** on that bucket,
and set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`. Do **not**
enable public access or a custom domain on this bucket.

---

## 6. Paymob setup (test first)

1. In Paymob, create a **test** integration for your currency (card, and wallet if you want it).
2. Copy from the dashboard: secret key, public key, integration id, HMAC secret.
3. Set `PAYMOB_REGION` (`eg`, `ksa`, `uae`, `om`), `PAYMOB_CURRENCY`, and `PAYMOB_INTEGRATION_ID`.
4. Callback URL is sent with every intention: `https://YOUR-DOMAIN/api/paymob-webhook`.
   Return URL: `https://YOUR-DOMAIN/payment-return?ref=…&t=…` (built per order, signed).
5. Set `SITE_URL` to the exact origin — it must match the deployed domain.

The signature implementation follows Paymob's documented order exactly:

```
amount_cents, created_at, currency, error_occured, has_parent_transaction, id,
integration_id, is_3d_secure, is_auth, is_capture, is_refunded,
is_standalone_payment, is_voided, order.id, owner, pending, source_data.pan,
source_data.sub_type, source_data.type, success
```

HMAC-SHA512, hex, compared in constant time against `?hmac=`. The GET redirect variant (flat
`order_id`) is also implemented for reference.

### Order store (required)

Fulfilment needs a small persistent key/value store for orders and idempotency claims. Add the
**Vercel KV** integration (Upstash Redis) to the project — it sets `KV_REST_API_URL` and
`KV_REST_API_TOKEN` automatically. Alternatively set `UPSTASH_REDIS_REST_URL` /
`UPSTASH_REDIS_REST_TOKEN` from an Upstash database. The store is accessed over HTTPS, so there is
no extra npm dependency.

In production, checkout is **disabled** when no durable store is configured (fail closed, not
silently non-idempotent). `ALLOW_EPHEMERAL_STORE=true` exists only for local testing.

---

## 7. Email and contact form

1. Verify your sending domain in Resend.
2. `RESEND_API_KEY`, `EMAIL_FROM` (must use the verified domain), `CONTACT_TO_EMAIL`.
3. Optional: `EMAIL_REPLY_TO`, `DELIVERY_BCC_EMAIL`, `CONTACT_SERVICES`.

The inquiry form sends name, email, chosen service and message to `CONTACT_TO_EMAIL` with
`reply_to` set to the sender. It is protected by JSON-only content type, origin allowlist,
per-IP burst + hourly limits, a hidden honeypot, strict validation and HTML escaping.

Optional spam upgrade: create a Turnstile widget, set `TURNSTILE_SECRET_KEY` in Vercel and
`turnstileSiteKey` in `assets/site-config.js`. The widget only loads when a site key exists.

---

## 8. Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `SITE_URL` | yes | Canonical HTTPS origin for callbacks, emails, origin checks |
| `ALLOWED_ORIGINS` | no | Extra browser origins allowed to POST (preview domains) |
| `PAYMOB_REGION` | yes | `eg`/`ksa`/`uae`/`om` → API + checkout hosts |
| `PAYMOB_SECRET_KEY` | yes | Server-side intention creation |
| `PAYMOB_PUBLIC_KEY` | yes | Hosted checkout |
| `PAYMOB_INTEGRATION_ID` | yes | Payment integration used |
| `PAYMOB_HMAC_SECRET` | yes | Callback signature verification |
| `PAYMOB_CURRENCY` | yes | Must match products and the integration |
| `PAYMOB_CITY`/`STATE`/`POSTAL_CODE`/`COUNTRY` | no | Billing filler for Paymob |
| `PAYMOB_BASE_URL` / `PAYMOB_CHECKOUT_URL` | no | Override region defaults |
| `PAYMENT_SIGNING_SECRET` | yes | Signs order refs + return tokens (`openssl rand -hex 32`) |
| `DOWNLOAD_TOKEN_SECRET` | yes | Signs download links (different value!) |
| `DOWNLOAD_LINK_TTL_HOURS` | no | Link lifetime, default 168 h |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` (or `UPSTASH_*`) | yes | Order store + idempotency + rate limits |
| `RESEND_API_KEY`, `EMAIL_FROM`, `CONTACT_TO_EMAIL` | yes | Delivery + inquiries |
| `EMAIL_REPLY_TO`, `DELIVERY_BCC_EMAIL`, `CONTACT_SERVICES` | no | Email options |
| `TURNSTILE_SECRET_KEY`, `TURNSTILE_EXPECTED_HOSTNAME` | no | Spam protection |
| `PRODUCTS_JSON`, `DOWNLOAD_OBJECTS_JSON` | yes | Catalogue + private object keys |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | yes | Private delivery |
| `R2_SIGNED_URL_SECONDS` | no | Signed URL lifetime, default 120 s |
| `HEALTH_TOKEN` | no | Enables detailed `/api/health` diagnostics |
| `ALLOW_EPHEMERAL_STORE` | no | Local only; never in production |

Generate the two signing secrets:

```bash
openssl rand -hex 32   # PAYMENT_SIGNING_SECRET
openssl rand -hex 32   # DOWNLOAD_TOKEN_SECRET
```

---

## 9. Deploy

```bash
npm run verify                 # static audit + 56 tests
npx vercel link                # once, chooses/creates the project
npx vercel env add SITE_URL production   # repeat for each variable
npx vercel --prod
```

Or paste the variables in **Vercel → Project → Settings → Environment Variables**, then:

```bash
npx vercel --prod
```

Redeploy after changing any environment variable. Finally:

```bash
curl -s https://YOUR-DOMAIN/api/health | jq
curl -s "https://YOUR-DOMAIN/api/health?token=$HEALTH_TOKEN" | jq
```

The second call lists exactly which variables are still missing.

---

## 10. Testing

```bash
npm run check    # JS/ESM syntax, JSON, internal links, secret-exposure scan
npm test         # 56 automated tests
npm run verify   # both
```

Automated coverage (all passing, no credentials, no network):

- catalogue validation: inactive/mispriced/wrong-currency/undeliverable products are withheld, the
  private object key never reaches the client, server totals ignore client hints, quantity and
  duplicate guards, malformed JSON does not crash.
- checkout: method/JSON/origin enforcement, customer validation, unknown products, server-side
  pricing (2 × 25 000 = 50 000), correct intention payload, the documented Unified Checkout host,
  persisted order, Paymob rejection handling, per-IP rate limit.
- webhook: forged signature, tampered amount after signing, exactly one email per transaction,
  duplicate/replayed callbacks, a second genuine transaction, failed/pending/refunded/voided
  outcomes, amount mismatch, unknown order, delivery failure → 500 → retry succeeds, missing
  configuration, signed legacy `extras` payload.
- download: missing/tampered/expired tokens, unpaid order, product not in order, replaced
  transaction, valid 302 to a signed R2 URL with `Content-Disposition`, no credential leakage.
- contact: delivery, HTML escaping, service/email/length validation, honeypot, cross-origin and
  form-encoded rejection, provider failure, rate limiting, Turnstile enforcement.
- crypto/input: the 20-field HMAC order, single-field mutation, redirect HMAC, constant-time
  compare edge cases, token tampering/expiry, origin checks, email/phone/escape helpers.

Front-end behaviour was additionally exercised in a headless DOM (jsdom): populated, empty and
catalogue-failure states; filters; search; cart maths and persistence; checkout summary;
inquiry submit; embed lazy-loading; Escape handling; and XSS payloads in product/track fields
rendered as inert text.

**Not tested here — requires your credentials and a deployed domain:**

- a live Paymob test-mode payment end to end (intention → checkout page → callback → email →
  download → R2 file),
- real Resend delivery to your inbox,
- R2 signing against your bucket,
- Lighthouse/Core Web Vitals on production hardware.

Use Paymob's test cards in test mode and complete this checklist before switching to live keys.

### Manual acceptance checklist

1. `/api/health?token=…` reports `missing: []`.
2. Buy a pack in Paymob test mode with a test card → return page shows **Payment confirmed**.
3. The delivery email arrives; each link downloads the right ZIP from R2; links die after the TTL.
4. Re-send from the return page works and respects the hourly limit.
5. Declined card → order shows failed, no email, no files.
6. Repeat/replay the callback (Paymob dashboard or `curl` with the same `hmac`) → still one email.
7. Remove `EMAIL_FROM` → checkout refuses to start rather than take money it cannot deliver.
8. Contact form: one message arrives in the studio inbox with the service and a working reply-to;
   a sixth submission within ten minutes is rate limited.

---

## 11. Security notes

- **Prices and availability are server-side.** The catalogue endpoint is informational; checkout
  recomputes everything from `PRODUCTS_JSON`.
- **No secrets in the browser.** `npm run check` fails the build if a secret name or key shape
  appears in any shipped `assets/**/*.js`.
- **Signed, scoped, expiring links.** Download tokens carry order ref + product + expiry and are
  re-validated against the stored order before an R2 URL is signed.
- **Fulfilment is idempotent** per Paymob transaction id; duplicates and replays are ignored.
  Refunds and voids are recorded and lock delivery.
- **CSRF:** there are no cookies or sessions. Mutating endpoints require `application/json`
  (which browsers cannot send cross-site without CORS), an allowlisted `Origin`, and are rate
  limited. Requests without an `Origin` header (server-to-server, curl) are still fully validated.
- **Webhook authenticity:** only Paymob's HMAC-SHA512 over the documented fields is accepted;
  amount, currency and the stored order must also agree.
- **Headers:** strict CSP (`script-src 'self'`), HSTS, `nosniff`, COOP, restrictive
  `Permissions-Policy`. `X-Frame-Options`/`frame-ancestors` are intentionally omitted so the site
  can be embedded in previews; add `frame-ancestors 'self'` if you never need embedding.
- **Uploads:** the project accepts no user uploads — sample files reach R2 through your own
  tooling, never through the website.
- **Rate limiting** uses the KV store and fails open on a store outage (availability over
  strictness), while every state-changing endpoint still validates its input.

Remaining hardening ideas if traffic grows: put Cloudflare in front of the domain, add Turnstile
to checkout, add Sentry-style error monitoring, and rotate the two signing secrets periodically
(rotating them invalidates outstanding download links, which is the intended panic button).

---

## 12. Operations

| Symptom | Where to look |
|---|---|
| Checkout says payments are not enabled | `/api/health?token=…` → `missing` |
| Paymob rejects the intention | Vercel logs: `[keemz] Paymob intention failed` (status + hint) |
| Payment taken, no email | Vercel logs: `[keemz] delivery failed`; the webhook returns 500 so Paymob retries; fix `RESEND_API_KEY`/`EMAIL_FROM` and use "Email the links again" |
| Callback 401 | `PAYMOB_HMAC_SECRET` mismatch (test vs live credentials) |
| Callback 404 | `SITE_URL`/store mismatch, or an order older than 30 days |
| Download 403 | link expired, order unpaid/refunded, or `DOWNLOAD_TOKEN_SECRET` was rotated |
| Store empty | `PRODUCTS_JSON` inactive/mispriced/currency mismatch/no R2 object — warnings are in `/api/health?token=…` |
| Inquiry not arriving | Resend domain verification, `CONTACT_TO_EMAIL`, spam folder |

Order records live for 30 days and fulfilment claims for 14 days. Download links default to 7
days. All of these are configurable (`DOWNLOAD_LINK_TTL_HOURS`, constants in `lib/store.js`).

---

## 13. 3D scene

`assets/scene.js` imports from `assets/vendor/three.module.min.js`, a tree-shaken r160 build.
To rebuild it after changing the imports:

```bash
mkdir -p /tmp/three-build && cd /tmp/three-build
npm init -y && npm install three@0.160.0 esbuild
cat > entry.js <<'EOF'
export {
  Scene, PerspectiveCamera, WebGLRenderer,
  IcosahedronGeometry, Mesh, MeshPhysicalMaterial, MeshBasicMaterial,
  AmbientLight, PointLight, BufferGeometry, BufferAttribute, Points, PointsMaterial
} from 'three';
EOF
npx esbuild entry.js --bundle --minify --format=esm --legal-comments=none \
  --outfile=three.module.min.js
```

Copy the output to `assets/vendor/three.module.min.js` and keep the MIT licence header.

The scene pauses when off-screen or when the tab is hidden, caps device pixel ratio at 1.6,
scales particle count to the viewport and renders a single still frame under
`prefers-reduced-motion`. If WebGL is unavailable the canvas is removed and the CSS ambience
(gradient orbs, grain, orbit rings) carries the design.

---

## 14. Honest status

**Working and verified in this repository:** the site, the 3D scene, portfolio filtering and
playback UI, the store UI and server pricing, cart, order persistence, HMAC verification,
idempotent fulfilment logic, download authorisation, email templates, inquiry handling, security
headers, tests and static checks.

**Waiting on you:** real Paymob test credentials, a KV/Upstash database, a verified Resend domain
and inbox, an R2 bucket plus API token, real products and audio files, and your real contact
details. Until those exist the store shows its empty state and checkout is disabled — that is
deliberate, not a bug.

**Not claimed:** that a live payment has completed. That test needs your merchant account; the
checklist in §10 is the shortest path to it.

---

## 15. Credits

- Three.js r160 — MIT (`assets/vendor/three-LICENSE.txt`)
- Syne and DM Mono — SIL Open Font License 1.1 (`assets/fonts/OFL-*.txt`)
- No other runtime dependencies beyond the AWS SDK used for R2 signing.

© Keemz Audio Lab. All studio content, audio and sample packs remain the property of their owner.
