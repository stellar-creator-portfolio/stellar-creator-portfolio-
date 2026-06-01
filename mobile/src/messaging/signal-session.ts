/**
 * messaging/signal-session.ts
 *
 * Signal protocol session management:
 *  - X3DH key agreement to establish sessions
 *  - Double Ratchet encrypt / decrypt
 *  - Key rotation: signed pre-key rotated every 7 days,
 *    one-time pre-keys replenished when supply drops below threshold
 *
 * Deps: @signalapp/libsignal-client, expo-secure-store
 */

import * as SecureStore from 'expo-secure-store';
import {
  SessionStore,
  PreKeyStore,
  SignedPreKeyStore,
  IdentityKeyStore,
  SessionRecord,
  PreKeyBundle,
  PublicKey,
  PrivateKey,
  SignedPreKeyRecord,
  PreKeyRecord,
  processPreKeyBundle,
  signalEncrypt,
  signalDecrypt,
  signalDecryptPreKey,
  CiphertextMessageType,
  ProtocolAddress,
} from '@signalapp/libsignal-client';
import {
  getOrCreateIdentity,
  getOrCreateSignedPreKey,
  generateOneTimePreKeys,
  consumeOneTimePreKey,
} from './key-store';
import type { EncryptedMessage, DecryptedMessage, KeyBundle } from '../types';

// ─── Key rotation constants ───────────────────────────────────────────────────

const SPK_ROTATION_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const OPK_REPLENISH_THRESHOLD  = 3;
const SECURE_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

// ─── In-memory + SecureStore backed Signal stores ────────────────────────────

class SecureSessionStore implements SessionStore {
  private prefix = 'signal.session.';

  async saveSession(address: ProtocolAddress, record: SessionRecord): Promise<void> {
    const key = `${this.prefix}${address.name()}.${address.deviceId()}`;
    await SecureStore.setItemAsync(key, Buffer.from(record.serialize()).toString('base64'), SECURE_OPTS);
  }

  async getSession(address: ProtocolAddress): Promise<SessionRecord | null> {
    const key    = `${this.prefix}${address.name()}.${address.deviceId()}`;
    const stored = await SecureStore.getItemAsync(key, SECURE_OPTS);
    if (!stored) return null;
    return SessionRecord.deserialize(Buffer.from(stored, 'base64'));
  }

  async getExistingSessions(addresses: ProtocolAddress[]): Promise<SessionRecord[]> {
    const results = await Promise.all(addresses.map((a) => this.getSession(a)));
    return results.filter((r): r is SessionRecord => r !== null);
  }
}

class SecurePreKeyStore implements PreKeyStore {
  async savePreKey(id: number, record: PreKeyRecord): Promise<void> {
    await SecureStore.setItemAsync(`signal.opk.${id}`, Buffer.from(record.serialize()).toString('base64'), SECURE_OPTS);
  }

  async getPreKey(id: number): Promise<PreKeyRecord> {
    const stored = await SecureStore.getItemAsync(`signal.opk.${id}`, SECURE_OPTS);
    if (!stored) throw new Error(`PreKey ${id} not found`);
    return PreKeyRecord.deserialize(Buffer.from(stored, 'base64'));
  }

  async removePreKey(id: number): Promise<void> {
    await SecureStore.deleteItemAsync(`signal.opk.${id}`, SECURE_OPTS);
  }
}

class SecureSignedPreKeyStore implements SignedPreKeyStore {
  async saveSignedPreKey(id: number, record: SignedPreKeyRecord): Promise<void> {
    await SecureStore.setItemAsync(`signal.spk.${id}`, Buffer.from(record.serialize()).toString('base64'), SECURE_OPTS);
  }

  async getSignedPreKey(id: number): Promise<SignedPreKeyRecord> {
    const stored = await SecureStore.getItemAsync(`signal.spk.${id}`, SECURE_OPTS);
    if (!stored) throw new Error(`SignedPreKey ${id} not found`);
    return SignedPreKeyRecord.deserialize(Buffer.from(stored, 'base64'));
  }
}

class SecureIdentityStore implements IdentityKeyStore {
  async getIdentityKey(): Promise<PrivateKey> {
    const { identityKeyPair } = await getOrCreateIdentity();
    return identityKeyPair.privateKey;
  }

  async getLocalRegistrationId(): Promise<number> {
    const { registrationId } = await getOrCreateIdentity();
    return registrationId;
  }

  async saveIdentity(address: ProtocolAddress, key: PublicKey): Promise<boolean> {
    const k       = `signal.identity.remote.${address.name()}`;
    const existing = await SecureStore.getItemAsync(k, SECURE_OPTS);
    await SecureStore.setItemAsync(k, Buffer.from(key.serialize()).toString('base64'), SECURE_OPTS);
    return existing !== null;
  }

  async isTrustedIdentity(address: ProtocolAddress, key: PublicKey): Promise<boolean> {
    const k       = `signal.identity.remote.${address.name()}`;
    const stored  = await SecureStore.getItemAsync(k, SECURE_OPTS);
    if (!stored) return true; // Trust on first use (TOFU)
    const trusted = PublicKey.deserialize(Buffer.from(stored, 'base64'));
    return trusted.compare(key) === 0;
  }

  async getIdentity(address: ProtocolAddress): Promise<PublicKey | null> {
    const k      = `signal.identity.remote.${address.name()}`;
    const stored = await SecureStore.getItemAsync(k, SECURE_OPTS);
    if (!stored) return null;
    return PublicKey.deserialize(Buffer.from(stored, 'base64'));
  }
}

// ─── Session manager ──────────────────────────────────────────────────────────

export class SignalSessionManager {
  private sessionStore    = new SecureSessionStore();
  private preKeyStore     = new SecurePreKeyStore();
  private signedPreKeyStore = new SecureSignedPreKeyStore();
  private identityStore   = new SecureIdentityStore();

  // ── Establish session from remote key bundle (X3DH) ────────────────────────

  async establishSession(remoteUserId: string, bundle: KeyBundle): Promise<void> {
    const address = ProtocolAddress.new(remoteUserId, 1);

    const preKeyBundle = PreKeyBundle.new(
      await this.identityStore.getLocalRegistrationId(),
      1,
      bundle.oneTimePreKeys[0]?.keyId ?? null,
      bundle.oneTimePreKeys[0]
        ? PublicKey.deserialize(bundle.oneTimePreKeys[0].publicKey)
        : null,
      bundle.signedPreKey.keyId,
      PublicKey.deserialize(bundle.signedPreKey.publicKey),
      bundle.signedPreKey.signature,
      PublicKey.deserialize(bundle.identityKey),
    );

    await processPreKeyBundle(
      preKeyBundle,
      address,
      this.sessionStore,
      this.identityStore,
    );
  }

  // ── Encrypt ────────────────────────────────────────────────────────────────

  async encrypt(remoteUserId: string, plaintext: string): Promise<EncryptedMessage> {
    const address    = ProtocolAddress.new(remoteUserId, 1);
    const msgBuffer  = Buffer.from(plaintext, 'utf8');
    const ciphertext = await signalEncrypt(msgBuffer, address, this.sessionStore, this.identityStore);

    return {
      id:          crypto.randomUUID(),
      senderId:    (await getOrCreateIdentity()).registrationId.toString(),
      recipientId: remoteUserId,
      ciphertext:  new Uint8Array(ciphertext.serialize()),
      messageType: ciphertext.type() as 1 | 3,
      timestamp:   Date.now(),
    };
  }

  // ── Decrypt ────────────────────────────────────────────────────────────────

  async decrypt(msg: EncryptedMessage): Promise<DecryptedMessage> {
    const address = ProtocolAddress.new(msg.senderId, 1);
    let plaintext: Buffer;

    if (msg.messageType === CiphertextMessageType.PreKey) {
      plaintext = await signalDecryptPreKey(
        msg.ciphertext,
        address,
        this.sessionStore,
        this.identityStore,
        this.preKeyStore,
        this.signedPreKeyStore,
      );
    } else {
      plaintext = await signalDecrypt(msg.ciphertext, address, this.sessionStore, this.identityStore);
    }

    return {
      id:        msg.id,
      senderId:  msg.senderId,
      body:      plaintext.toString('utf8'),
      timestamp: msg.timestamp,
    };
  }

  // ── Key rotation ───────────────────────────────────────────────────────────

  /**
   * Call periodically (e.g. on app foreground).
   * Rotates signed pre-key if older than SPK_ROTATION_INTERVAL_MS.
   * Replenishes one-time pre-keys if supply is low.
   * Returns new key bundle to upload to server if rotation occurred.
   */
  async rotateKeysIfNeeded(): Promise<KeyBundle | null> {
    const lastRotationStr = await SecureStore.getItemAsync('signal.spk.last_rotation', SECURE_OPTS);
    const lastRotation    = lastRotationStr ? parseInt(lastRotationStr, 10) : 0;
    const now             = Date.now();

    let rotated = false;

    // Signed pre-key rotation
    if (now - lastRotation > SPK_ROTATION_INTERVAL_MS) {
      const { identityKeyPair } = await getOrCreateIdentity();
      await getOrCreateSignedPreKey(identityKeyPair); // generates new key with incremented id
      await SecureStore.setItemAsync('signal.spk.last_rotation', String(now), SECURE_OPTS);
      rotated = true;
    }

    // One-time pre-key replenishment
    const counterStr = await SecureStore.getItemAsync('signal.opk.counter', SECURE_OPTS);
    const counter    = counterStr ? parseInt(counterStr, 10) : 0;
    const usedStr    = await SecureStore.getItemAsync('signal.opk.used', SECURE_OPTS);
    const used       = usedStr ? parseInt(usedStr, 10) : 0;
    const remaining  = counter - used;

    if (remaining < OPK_REPLENISH_THRESHOLD) {
      await generateOneTimePreKeys();
      rotated = true;
    }

    if (!rotated) return null;

    // Build and return updated bundle for server upload
    const { identityKeyPair } = await getOrCreateIdentity();
    const spk                 = await getOrCreateSignedPreKey(identityKeyPair);
    const newOpks             = await generateOneTimePreKeys();

    return {
      identityKey: identityKeyPair.publicKey.serialize(),
      signedPreKey: {
        keyId:     spk.id(),
        publicKey: spk.publicKey().serialize(),
        signature: spk.signature(),
      },
      oneTimePreKeys: newOpks.map((k) => ({
        keyId:     k.id(),
        publicKey: k.publicKey().serialize(),
      })),
    };
  }
}
