/**
 * messaging/key-store.ts
 *
 * Manages Signal protocol identity keys, signed pre-keys, and one-time
 * pre-keys using Expo SecureStore (iOS Keychain / Android Keystore).
 *
 * Deps (add to mobile package.json):
 *   expo-secure-store, @signalapp/libsignal-client
 */

import * as SecureStore from 'expo-secure-store';
import {
  PrivateKey,
  PublicKey,
  KEMKeyPair,
  SignedPreKeyRecord,
  PreKeyRecord,
  IdentityKeyPair,
  generateRegistrationId,
} from '@signalapp/libsignal-client';
import type { KeyBundle } from '../types';

// ─── Storage keys ─────────────────────────────────────────────────────────────

const KEYS = {
  IDENTITY_PRIVATE:    'signal.identity.private',
  IDENTITY_PUBLIC:     'signal.identity.public',
  REGISTRATION_ID:     'signal.registrationId',
  SIGNED_PREKEY_BASE:  'signal.spk.',
  SIGNED_PREKEY_CURRENT: 'signal.spk.current_id',
  OPK_BASE:            'signal.opk.',
  OPK_COUNTER:         'signal.opk.counter',
} as const;

// SecureStore options — require device authentication for sensitive keys
const SECURE_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function b64(buf: Uint8Array): string {
  return Buffer.from(buf).toString('base64');
}

function fromb64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, 'base64'));
}

// ─── Identity ─────────────────────────────────────────────────────────────────

export async function getOrCreateIdentity(): Promise<{
  identityKeyPair: IdentityKeyPair;
  registrationId: number;
}> {
  const storedPriv = await SecureStore.getItemAsync(KEYS.IDENTITY_PRIVATE, SECURE_OPTS);
  const storedPub  = await SecureStore.getItemAsync(KEYS.IDENTITY_PUBLIC,  SECURE_OPTS);
  const storedRid  = await SecureStore.getItemAsync(KEYS.REGISTRATION_ID,  SECURE_OPTS);

  if (storedPriv && storedPub && storedRid) {
    const privateKey = PrivateKey.deserialize(fromb64(storedPriv));
    const publicKey  = PublicKey.deserialize(fromb64(storedPub));
    return {
      identityKeyPair: IdentityKeyPair.new(publicKey, privateKey),
      registrationId:  parseInt(storedRid, 10),
    };
  }

  // First run — generate and persist
  const identityKeyPair = IdentityKeyPair.generate();
  const registrationId  = generateRegistrationId();

  await SecureStore.setItemAsync(KEYS.IDENTITY_PRIVATE, b64(identityKeyPair.privateKey.serialize()), SECURE_OPTS);
  await SecureStore.setItemAsync(KEYS.IDENTITY_PUBLIC,  b64(identityKeyPair.publicKey.serialize()),  SECURE_OPTS);
  await SecureStore.setItemAsync(KEYS.REGISTRATION_ID,  String(registrationId),                      SECURE_OPTS);

  return { identityKeyPair, registrationId };
}

// ─── Signed pre-key ───────────────────────────────────────────────────────────

export async function getOrCreateSignedPreKey(
  identityKeyPair: IdentityKeyPair,
): Promise<SignedPreKeyRecord> {
  const currentIdStr = await SecureStore.getItemAsync(KEYS.SIGNED_PREKEY_CURRENT, SECURE_OPTS);
  const currentId    = currentIdStr ? parseInt(currentIdStr, 10) : null;

  if (currentId !== null) {
    const stored = await SecureStore.getItemAsync(`${KEYS.SIGNED_PREKEY_BASE}${currentId}`, SECURE_OPTS);
    if (stored) return SignedPreKeyRecord.deserialize(fromb64(stored));
  }

  const keyId  = (currentId ?? 0) + 1;
  const record = SignedPreKeyRecord.new(
    keyId,
    Date.now(),
    identityKeyPair.privateKey.generateKeyPair().publicKey,
    identityKeyPair.privateKey.generateKeyPair().privateKey,
    identityKeyPair.privateKey.sign(
      identityKeyPair.privateKey.generateKeyPair().publicKey.serialize(),
    ),
  );

  await SecureStore.setItemAsync(`${KEYS.SIGNED_PREKEY_BASE}${keyId}`, b64(record.serialize()), SECURE_OPTS);
  await SecureStore.setItemAsync(KEYS.SIGNED_PREKEY_CURRENT, String(keyId), SECURE_OPTS);

  return record;
}

// ─── One-time pre-keys ────────────────────────────────────────────────────────

const OPK_BATCH = 10;

export async function generateOneTimePreKeys(): Promise<PreKeyRecord[]> {
  const counterStr = await SecureStore.getItemAsync(KEYS.OPK_COUNTER, SECURE_OPTS);
  let counter      = counterStr ? parseInt(counterStr, 10) : 0;

  const records: PreKeyRecord[] = [];

  for (let i = 0; i < OPK_BATCH; i++) {
    const keyId  = ++counter;
    const kp     = PrivateKey.generate().generateKeyPair();
    const record = PreKeyRecord.new(keyId, kp.publicKey, kp.privateKey);
    await SecureStore.setItemAsync(`${KEYS.OPK_BASE}${keyId}`, b64(record.serialize()), SECURE_OPTS);
    records.push(record);
  }

  await SecureStore.setItemAsync(KEYS.OPK_COUNTER, String(counter), SECURE_OPTS);
  return records;
}

export async function consumeOneTimePreKey(keyId: number): Promise<PreKeyRecord | null> {
  const stored = await SecureStore.getItemAsync(`${KEYS.OPK_BASE}${keyId}`, SECURE_OPTS);
  if (!stored) return null;
  await SecureStore.deleteItemAsync(`${KEYS.OPK_BASE}${keyId}`, SECURE_OPTS);
  return PreKeyRecord.deserialize(fromb64(stored));
}

// ─── Key bundle (published to server) ────────────────────────────────────────

export async function buildKeyBundle(): Promise<KeyBundle> {
  const { identityKeyPair } = await getOrCreateIdentity();
  const spk                 = await getOrCreateSignedPreKey(identityKeyPair);
  const opks                = await generateOneTimePreKeys();

  return {
    identityKey: identityKeyPair.publicKey.serialize(),
    signedPreKey: {
      keyId:     spk.id(),
      publicKey: spk.publicKey().serialize(),
      signature: spk.signature(),
    },
    oneTimePreKeys: opks.map((k) => ({
      keyId:     k.id(),
      publicKey: k.publicKey().serialize(),
    })),
  };
}
