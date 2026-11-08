/*
  EDIT THIS FILE to connect your public artist pages and audio.
  Keep payment secrets and download object keys OUT of this file.
*/
window.KAL_CONFIG = {
  contactEmail: "hello@keemzaudiolab.com",
  whatsapp: "", // international format, digits only; example: 201XXXXXXXXX
  socials: {
    instagram: "",
    soundcloud: "",
    spotify: "",
    youtube: ""
  },
  featured: {
    soundcloud: "", // SoundCloud track / playlist URL
    spotify: "",    // Spotify track / playlist / album / artist URL
    youtube: ""     // YouTube video / playlist / channel URL
  },
  tracks: [
    // { title: "Track title", category: "Beat", note: "140 BPM · Drill", type: "audio", src: "/audio/track-preview.mp3" }
    // { title: "Sound design study", category: "Sound design", note: "Texture / atmosphere", type: "soundcloud", src: "https://soundcloud.com/your-name/your-track" }
  ],
  services: [
    { number: "01", glyph: "◈", name: "Beat Production", description: "Rhythmic architecture from the ground up — drums, bass, melody and arrangement built around the artist and the record." },
    { number: "02", glyph: "◉", name: "Sound Design", description: "Synthesis, sampling and sonic sculpting. Custom textures and atmospheres designed around your creative direction." },
    { number: "03", glyph: "⊕", name: "Mixing & Mastering", description: "A focused mix and master with clarity, depth, translation and delivery specs considered from the start." },
    { number: "04", glyph: "◎", name: "Stem Separation", description: "Vocal, drum, bass and instrumental isolation with careful cleanup and organized WAV delivery." }
  ]
};
