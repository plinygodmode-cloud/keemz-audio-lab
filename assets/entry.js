/* KEEMZ Audio Lab — interactive entry sequence */
(() => {
  'use strict';

  const screen = document.getElementById('entry-screen');
  const enter = document.getElementById('entry-enter');
  const sound = document.getElementById('entry-sound');
  const footerSound = document.getElementById('experience-sound');
  const clock = document.getElementById('entry-clock');
  const date = document.getElementById('entry-date');
  const progress = document.getElementById('entry-progress');
  if (!screen || !enter) return;

  const root = document.documentElement;
  root.classList.add('entry-active');

  const cairoTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23'
  });
  const cairoDate = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
  });

  function updateClock() {
    const now = new Date();
    if (clock) clock.textContent = cairoTime.format(now);
    if (date) date.textContent = cairoDate.format(now).toUpperCase();
  }
  updateClock();
  window.setInterval(updateClock, 1000);

  let audioContext = null;
  let master = null;
  let soundEnabled = true;
  let entered = false;

  function startAudio() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      soundEnabled = false;
      updateSoundLabel();
      return;
    }
    if (!audioContext) {
      audioContext = new AudioContextClass();
      master = audioContext.createGain();
      master.gain.value = 0;
      master.connect(audioContext.destination);

      const filter = audioContext.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 420;
      filter.Q.value = 0.45;
      filter.connect(master);

      [55, 82.41, 110, 164.81].forEach((frequency, index) => {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const lfo = audioContext.createOscillator();
        const lfoGain = audioContext.createGain();
        oscillator.type = index === 3 ? 'sine' : 'triangle';
        oscillator.frequency.value = frequency;
        oscillator.detune.value = index % 2 ? -4 : 3;
        gain.gain.value = [0.12, 0.07, 0.035, 0.012][index];
        lfo.frequency.value = 0.035 + index * 0.012;
        lfoGain.gain.value = 2.5 + index;
        lfo.connect(lfoGain);
        lfoGain.connect(oscillator.detune);
        oscillator.connect(gain);
        gain.connect(filter);
        oscillator.start();
        lfo.start();
      });
    }
    if (audioContext.state === 'suspended') audioContext.resume();
    master.gain.cancelScheduledValues(audioContext.currentTime);
    master.gain.setTargetAtTime(soundEnabled ? 0.34 : 0, audioContext.currentTime, 0.9);
  }

  function playTone(frequency, duration, volume, type) {
    if (!audioContext || !master || !soundEnabled) return;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const now = audioContext.currentTime;
    oscillator.type = type || 'sine';
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, frequency * 0.62), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.03);
  }

  function updateSoundLabel() {
    if (!sound) return;
    if (sound) {
      sound.textContent = soundEnabled ? 'SOUND ON' : 'SOUND OFF';
      sound.setAttribute('aria-pressed', String(soundEnabled));
    }
    if (footerSound) {
      footerSound.innerHTML = (soundEnabled ? 'sound on' : 'sound off') + ' <span aria-hidden="true">◖</span>';
      footerSound.setAttribute('aria-pressed', String(soundEnabled));
    }
  }

  function toggleSound() {
    soundEnabled = !soundEnabled;
    if (soundEnabled) startAudio();
    else if (audioContext && master) {
      master.gain.setTargetAtTime(0, audioContext.currentTime, 0.18);
    }
    updateSoundLabel();
  }
  sound?.addEventListener('click', toggleSound);
  footerSound?.addEventListener('click', toggleSound);

  function enterExperience() {
    if (entered) return;
    entered = true;
    if (soundEnabled) {
      startAudio();
      playTone(180, 0.72, 0.055, 'sine');
      window.setTimeout(() => playTone(520, 0.16, 0.018, 'triangle'), 110);
    }
    screen.classList.add('is-leaving');
    root.classList.remove('entry-active');
    window.setTimeout(() => {
      screen.hidden = true;
      screen.setAttribute('aria-hidden', 'true');
    }, 1050);
  }

  enter.addEventListener('click', enterExperience);
  window.addEventListener('keydown', event => {
    if (!entered && (event.key === 'Enter' || event.key === ' ')) {
      if (event.target === sound) return;
      event.preventDefault();
      if (!enter.disabled) enterExperience();
    }
  });

  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  screen.classList.add('is-booting');
  window.setTimeout(() => {
    screen.classList.add('is-ready');
    enter.disabled = false;
    if (progress) progress.setAttribute('aria-valuenow', '100');
  }, reducedMotion ? 120 : 2350);

  updateSoundLabel();
})();
