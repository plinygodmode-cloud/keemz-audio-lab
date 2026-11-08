/*
  KEEMZ AUDIO LAB — public site configuration
  ===========================================
  Everything visitors can see is edited here. Nothing secret belongs in this
  file: payment keys, download object keys and API keys live in Vercel
  environment variables only.

  Leave a value empty and the related UI is hidden (never a dead link).
  This file is loaded before assets/app.js and is safe to edit by hand.
*/
window.KAL_CONFIG = {
  // --- Identity -----------------------------------------------------------
  siteName: "Keemz Audio Lab",
  tagline: "Sound, engineered.",
  location: "Cairo / Global",

  // Shown in the hero panel. Set to "" to hide the availability pill.
  availability: "Taking briefs",
  // Shown above the inquiry form. Set to "" to hide it.
  responseTime: "Reply within 1–2 business days",

  // Public inbox and WhatsApp number (international format, digits only).
  // These are only rendered when they look valid. Use your real details.
  contactEmail: "hello@keemzaudiolab.com",
  whatsapp: "",

  // --- Channels -----------------------------------------------------------
  socials: {
    instagram: "",
    soundcloud: "",
    spotify: "",
    youtube: ""
  },

  // One real URL per provider; each becomes a live player when set.
  featured: {
    soundcloud: "",
    spotify: "",
    youtube: ""
  },

  // --- Portfolio ----------------------------------------------------------
  /*
    Each track supports:
      title       string
      category    string  (used by the filter bar, e.g. "Beats", "Mix")
      type        "audio" | "soundcloud" | "spotify" | "youtube"
      src         same-site audio path ("/audio/preview.mp3") or a provider URL
      note        short line of production detail
      bpm         number  (optional)
      genre       string  (optional)
      key         string  (optional)
      artwork     same-site image path (optional, e.g. "/assets/img/track.jpg")
      featured    boolean (optional, shown first)
      description string  (optional, one sentence)

    Example (uncomment after uploading a real preview):
    {
      title: "Night Shift",
      category: "Beats",
      type: "audio",
      src: "/audio/night-shift-preview.mp3",
      note: "Drill · 142 BPM · C minor",
      bpm: 142,
      genre: "Drill",
      key: "Cm",
      artwork: "/assets/img/night-shift.jpg",
      featured: true,
      description: "Built from a single Rhodes loop and a resampled drum bus."
    }
  */
  tracks: [],

  // --- Services -----------------------------------------------------------
  // `inquiry` must match an option in the contact form (or a value listed in
  // the CONTACT_SERVICES environment variable).
  services: [
    {
      number: "01",
      glyph: "◈",
      name: "Beat Production",
      inquiry: "Beat production",
      description:
        "Rhythmic architecture from the ground up — drums, bass, melody and arrangement built around the artist and the record."
    },
    {
      number: "02",
      glyph: "◉",
      name: "Sound Design",
      inquiry: "Sound design",
      description:
        "Synthesis, sampling and sonic sculpting. Custom textures and atmospheres designed around your creative direction."
    },
    {
      number: "03",
      glyph: "⊕",
      name: "Mixing & Mastering",
      inquiry: "Mixing & mastering",
      description:
        "A focused mix and master with clarity, depth, translation and delivery specs considered from the start."
    },
    {
      number: "04",
      glyph: "◎",
      name: "Stem Separation",
      inquiry: "Stem separation",
      description:
        "Vocal, drum, bass and instrumental isolation with careful cleanup and organized WAV delivery."
    }
  ],

  // Options in the contact form. Keep them in sync with CONTACT_SERVICES if
  // you set that environment variable.
  inquiryOptions: [
    "Beat production",
    "Sound design",
    "Mixing & mastering",
    "Stem separation",
    "Custom sample pack",
    "Other / collaboration"
  ],

  // --- Studio strip -------------------------------------------------------
  // Short, factual studio facts. Edit to match how you actually work.
  signals: [
    { value: "48", unit: "kHz", label: "Session sample rate" },
    { value: "32", unit: "bit", label: "Float headroom" },
    { value: "WAV", unit: "", label: "Masters & stems" },
    { value: "∞", unit: "", label: "Frequencies explored" }
  ],

  // --- Store --------------------------------------------------------------
  // Products are NOT defined here. They come from the server (PRODUCTS_JSON
  // in Vercel) so prices cannot be tampered with in the browser.
  storeNote:
    "Instant digital delivery. Each pack is delivered as a private, expiring download after Paymob confirms the payment.",
  licensingUrl: "/licensing",

  // Optional Cloudflare Turnstile site key for the inquiry form. The matching
  // secret is TURNSTILE_SECRET_KEY in Vercel. Leave empty to disable.
  turnstileSiteKey: ""
};
