import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';
import { AppConfig } from '../../config/configuration';

/**
 * Symmetric secret sealing for values that must never be stored in plaintext
 * (SEC-002), e.g. per-project cloud LLM API keys. AES-256-GCM with a random
 * 12-byte IV per seal; the auth tag detects any tampering with the ciphertext.
 *
 * Key material comes from SECRETS_ENCRYPTION_KEY, falling back to a key
 * derived from JWT_ACCESS_SECRET so local dev works without extra setup.
 * Wire format: `v1.<iv>.<tag>.<ciphertext>` (base64url parts).
 */
@Injectable()
export class SecretBoxService {
  private readonly key: Buffer | null;

  constructor(config: ConfigService) {
    const secretsKey = config.get<AppConfig['secretsKey']>('secretsKey') || '';
    const jwtSecret = config.get<AppConfig['jwt']>('jwt')?.accessSecret || '';
    const material = secretsKey || (jwtSecret ? `secret-box|${jwtSecret}` : '');
    this.key = material ? createHash('sha256').update(material).digest() : null;
  }

  private requireKey(): Buffer {
    if (!this.key) {
      throw new Error(
        'No encryption key available: set SECRETS_ENCRYPTION_KEY (or JWT_ACCESS_SECRET)',
      );
    }
    return this.key;
  }

  seal(plaintext: string): string {
    const key = this.requireKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const b64 = (b: Buffer) => b.toString('base64url');
    return `v1.${b64(iv)}.${b64(tag)}.${b64(ct)}`;
  }

  open(sealed: string): string {
    const key = this.requireKey();
    const [version, ivB64, tagB64, ctB64] = sealed.split('.');
    if (version !== 'v1' || !ivB64 || !tagB64 || !ctB64) {
      throw new Error('Malformed sealed secret');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(ivB64, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
