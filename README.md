# KEEMZ AUDIO LAB

A Vercel-ready audio portfolio and digital sample store. The visual direction keeps the original cyan / electric-green 3D identity, while the site adds configurable music embeds, a playable portfolio, a server-backed product catalogue, a multi-item cart, Paymob-hosted checkout, verified payment callbacks, private R2 downloads and an email inquiry form.

## What works now

- Responsive one-page portfolio with the Three.js object, reduced-motion handling and a CSS fallback.
- SoundCloud, Spotify and YouTube embeds, rendered only when real URLs are configured.
- MP3/WAV previews from same-site paths such as `/audio/preview.mp3`, or provider embeds in the portfolio.
- Product catalogue, quantity controls and multi-item cart. Prices are always recalculated by the server.
- Paymob Intention API checkout. The browser is redirected to Paymob's hosted checkout; it never receives secret keys.
- Paymob HMAC callback verification, a signed order reference, and seven-day, signed download links backed by a private Cloudflare R2 bucket.
- Contact form delivered through Resend, with input validation, HTML escaping and a honeypot field.

The store deliberately shows no made-up products. It stays empty until real products, prices and private download objects are configured. Payments and email delivery are not live until your own provider credentials are added and tested.

## 1. Local setup

Requirements: Node.js 20 or newer, npm, and a Vercel account.

```bash
npm install
cp .env.example .env.local
npx vercel dev
```

Open the local URL printed by Vercel. API-backed checkout, catalogue and forms require the environment variables below.

## 2. Connect your music

Edit `assets/site-config.js`:

- Add the actual Instagram, SoundCloud, Spotify and YouTube profile URLs under `socials`.
- Add one actual track / playlist / video URL under each `featured` provider you use.
- Add portfolio entries to `tracks`.

Native audio example:

```js
{ title: "Your track", category: "Beat", note: "140 BPM · Drill", type: "audio", src: "/audio/your-preview.mp3" }
```

Put the preview at `audio/your-preview.mp3` in the project root so the URL is `/audio/your-preview.mp3`. Do not upload full commercial masters unless you intend them to be public. SoundCloud, Spotify and YouTube portfolio items can use `type: "soundcloud"`, `"spotify"` or `"youtube"` with their normal share URL in `src`.

## 3. Add real sample packs

Add each finished ZIP to a **private** Cloudflare R2 bucket. Do not place paid ZIP files in the public website folder or expose R2 object keys in `assets/site-config.js`.

In Vercel Environment Variables, set `PRODUCTS_JSON` to a JSON array. Example structure (replace every sample value with your real product details):

```json
[
  {
    "id": "your-pack-id",
    "name": "Your Pack Name",
    "description": "What is inside the pack.",
    "priceMinor": 25000,
    "currency": "EGP",
    "active": true,
    "tags": ["WAV", "MIDI"],
    "format": "WAV + MIDI",
    "glyph": "◈"
  }
]
```

`priceMinor` is the smallest currency unit: `25000` means EGP 250.00. Use integer values only. The currency must match `PAYMOB_CURRENCY` and the selected Paymob integration. Set `DOWNLOAD_OBJECTS_JSON` to a JSON object mapping the product ID to the exact R2 object key:

```json
{"your-pack-id":"packs/your-pack-file.zip"}
```

Only active products with a matching private object key appear in the store.

## 4. Configure payment, delivery and contact email

Copy the keys from `.env.example` into **Vercel → Project → Settings → Environment Variables**. Do not commit `.env.local` and do not put private keys in `assets/site-config.js`.

| Variable | Purpose |
|---|---|
| `SITE_URL` | Deployed site origin, e.g. `https://keemzaudiolab.vercel.app` |
| `PAYMOB_SECRET_KEY` | Paymob server-side secret key |
| `PAYMOB_PUBLIC_KEY` | Paymob public key used by hosted checkout |
| `PAYMOB_INTEGRATION_ID` | Payment integration ID that matches currency and test/live mode |
| `PAYMOB_HMAC_SECRET` | Paymob callback HMAC secret |
| `PAYMOB_CURRENCY` | Currency configured in the Paymob integration; defaults to EGP |
| `PAYMENT_SIGNING_SECRET` | Private key used to sign the order reference |
| `DOWNLOAD_TOKEN_SECRET` | Private key used to sign expiring download links |
| `RESEND_API_KEY` | Resend API key for inquiry and delivery email |
| `EMAIL_FROM` | Sender address verified with Resend |
| `CONTACT_TO_EMAIL` | Inbox that receives project inquiries |
| `PRODUCTS_JSON` | Real product catalogue and integer prices |
| `DOWNLOAD_OBJECTS_JSON` | Private R2 object keys per product ID |
| `R2_ACCOUNT_ID` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 S3-compatible credentials |
| `R2_BUCKET_NAME` | Private R2 bucket name |

Generate independent long random values for the two signing secrets, for example:

```bash
openssl rand -hex 32
openssl rand -hex 32
```

Paste one result into `PAYMENT_SIGNING_SECRET` and the other into `DOWNLOAD_TOKEN_SECRET`. Never reuse your Paymob or Resend API keys for these values.

In Paymob, create a payment integration for the currency you intend to charge, then use its matching test credentials and integration ID first. Configure the transaction callback / notification URL as:

`https://YOUR-DOMAIN/api/paymob-webhook`

Configure the return URL as:

`https://YOUR-DOMAIN/payment-return.html`

The return page is informational only. Fulfilment happens only when the server receives a valid Paymob-signed transaction callback and verifies the signed order, amount and currency. Test successful, failed and cancelled payments before switching to live credentials.

For Resend, verify the sender domain and set `EMAIL_FROM` to that approved sender. `CONTACT_TO_EMAIL` is your actual receiving inbox. Update `contactEmail` in `assets/site-config.js` too if the public contact email should be different.

## 5. Deploy to Vercel

```bash
npx vercel
```

Link the folder to the intended Vercel project, set the environment variables in the Vercel dashboard, then deploy production:

```bash
npx vercel --prod
```

Redeploy after changing environment variables. Add your custom domain in the Vercel project settings if you use one, and update `SITE_URL` to exactly that HTTPS origin.

## Before launch checklist

- [ ] Replace or verify `hello@keemzaudiolab.com` in `assets/site-config.js`.
- [ ] Add your real social profile links and working SoundCloud / Spotify / YouTube URLs.
- [ ] Upload only approved previews and add them to the portfolio config.
- [ ] Add your real sample pack files to a private R2 bucket.
- [ ] Set real product names, descriptions, prices and R2 object keys.
- [ ] Add Paymob **test** credentials and confirm the integration currency matches the catalogue.
- [ ] Verify your Resend sender domain and receiving inbox.
- [ ] Test checkout, callback fulfilment and download delivery before enabling live payments.
- [ ] Add legal pages / licence terms that accurately describe the rights granted with each pack before selling.

## Important notes

- This project does not invent your tracks, sample packs, audience stats, social accounts, customer email or phone number.
- Do not claim a pack is royalty-free or grant commercial rights unless you control the underlying sounds and the licence actually permits that use.
- The included inquiry endpoint uses a honeypot and origin check, but a public launch with meaningful traffic should add a proper rate limiter / spam service.
- This project has been syntax-checked locally. A live end-to-end payment test is not possible until the merchant credentials, products, private files and verified email sender are supplied.
