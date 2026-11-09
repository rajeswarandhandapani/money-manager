// Optional lock for one device, using a passkey (Face ID, fingerprint or the device passcode).
// There is no server, so the operating system's check of the person is the whole test. This keeps
// people out of the app. It does not encrypt what is stored.

import * as store from './store.js';
import { h } from './ui.js';

export const LOCK_AFTER_MINUTES = 3;
const LOCK_AFTER_MS = LOCK_AFTER_MINUTES * 60 * 1000;

// 32 letters and digits, leaving out the look-alikes 0, O, 1 and I. 20 of them is 100 random bits.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 20;

const random = size => crypto.getRandomValues(new Uint8Array(size));

let record = null;
let supported = false;
let screen = null;
let finished = null;
let usedRecovery = false;
let hiddenAt = 0;

export function newRecoveryCode() {
  const letters = Array.from(random(CODE_LENGTH), byte => ALPHABET[byte & 31]).join('');
  return letters.match(/.{4}/g).join('-');
}

export async function hashCode(code, salt) {
  const text = new TextEncoder().encode(code.toUpperCase().replace(/[^A-Z0-9]/g, ''));
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array([...salt, ...text]));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

export const isOn = () => Boolean(record?.credentialId);
export const isSupported = () => supported;
export const isLocked = () => Boolean(screen);

// create() and get() are called before anything is awaited: iPhones refuse them once the tap that
// asked for them has passed.
export async function createPasskey() {
  const userId = record?.userId || random(16);
  const { rawId } = await navigator.credentials.create({ publicKey: {
    rp: { name: 'Money Manager' },
    // Reusing the id makes turning the lock back on replace this device's passkey, not add another.
    user: { id: userId, name: 'Money Manager', displayName: 'Money Manager' },
    challenge: random(32),
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' },
    attestation: 'none',
  } });
  record = { userId };
  await store.setKv('lock', record);
  return rawId;
}

export async function turnOn(credentialId, code) {
  const salt = random(16);
  record = { userId: record.userId, credentialId, salt, hash: await hashCode(code, salt) };
  await store.setKv('lock', record);
}

const askDevice = () => navigator.credentials.get({ publicKey: {
  challenge: random(32),
  allowCredentials: [{ type: 'public-key', id: record.credentialId }],
  userVerification: 'required',
} });

/** Asks for Face ID again before the lock can be removed, unless the passkey has already failed. */
export async function turnOff() {
  if (!usedRecovery) await askDevice();
  record = { userId: record.userId };
  await store.setKv('lock', record);
}

function buildScreen() {
  const message = h('p', { class: 'lock-message', role: 'alert' });
  const open = () => {
    screen.remove();
    screen = null;
    document.body.classList.remove('locked');
    finished?.();
    finished = null;
  };

  const unlock = h('button', { class: 'primary lock-button', id: 'unlock', onclick: async () => {
    unlock.disabled = true;
    message.textContent = '';
    try {
      await askDevice();
      open();
    } catch {
      message.textContent = 'That didn’t work. Tap Unlock to try again.';
      unlock.disabled = false;
    }
  } }, 'Unlock');

  const input = h('input', { 'aria-label': 'Recovery code', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false' });
  const form = h('form', { class: 'stack', hidden: true, onsubmit: async e => {
    e.preventDefault();
    if (await hashCode(input.value, record.salt) === record.hash) {
      usedRecovery = true;
      open();
    } else {
      message.textContent = 'That code doesn’t match.';
    }
  } },
    input,
    h('button', { class: 'ghost' }, 'Unlock with code'),
    h('p', { class: 'muted' }, 'If your passkey has stopped working, turn the lock off and on again under Data once you’re in.'));

  const showCode = h('button', { class: 'link', onclick: () => { showCode.hidden = true; form.hidden = false; message.textContent = ''; input.focus(); } }, 'Use recovery code');

  return h('div', { id: 'lock' },
    h('img', { src: 'icons/icon-192.png', alt: '', width: 72, height: 72 }),
    h('h1', {}, 'Money Manager'),
    unlock, message, showCode, form);
}

function show() {
  usedRecovery = false;
  screen = buildScreen();
  document.body.classList.add('locked');
  document.body.append(screen);
}

/** Loads this device's lock and starts watching for the app being left. */
export async function init() {
  record = await store.getKv('lock') || null;
  supported = Boolean(await window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable?.().catch(() => false));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (isOn() && !screen && hiddenAt && Date.now() - hiddenAt >= LOCK_AFTER_MS) show();
  });
}

/** Resolves straight away with the lock off, otherwise once the person has got in. */
export function untilUnlocked() {
  if (!isOn()) return Promise.resolve();
  show();
  return new Promise(resolve => { finished = resolve; });
}
