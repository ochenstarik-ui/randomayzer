import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

export interface ITokenVault {
  encrypt(plaintext: string): Promise<string>;
  decrypt(ciphertext: string): Promise<string>;
}

export class AesGcmTokenVault implements ITokenVault {
  private key: Buffer | null = null;
  private static readonly ALGORITHM = 'aes-256-gcm';
  private static readonly IV_LENGTH = 12; // Standard 96-bit IV for GCM
  private static readonly AUTH_TAG_LENGTH = 16;
  private static readonly DEV_TEST_KEY = 'dev-explicit-test-encryption-key-32bytes!';
  private readonly explicitKey?: string;

  constructor(secretKey?: string) {
    this.explicitKey = secretKey;
    if (secretKey) {
      this.key = createHash('sha256').update(secretKey, 'utf8').digest();
    } else {
      // Validate immediately at instantiation unless running in Next.js static build phase
      const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build';
      if (!isBuildPhase) {
        this.getKey();
      }
    }
  }

  private getKey(): Buffer {
    if (this.key) return this.key;

    const rawSecret = this.explicitKey || process.env.TOKEN_ENCRYPTION_KEY;

    if (process.env.NODE_ENV === 'production') {
      if (!rawSecret) {
        throw new Error(
          'FATAL CONFIGURATION ERROR: TOKEN_ENCRYPTION_KEY environment variable is strictly required in production.'
        );
      }
      if (rawSecret.length < 32) {
        throw new Error(
          'FATAL CONFIGURATION ERROR: TOKEN_ENCRYPTION_KEY must be at least 32 characters long in production for cryptographic safety.'
        );
      }
    }

    const keyToUse = rawSecret || AesGcmTokenVault.DEV_TEST_KEY;
    this.key = createHash('sha256').update(keyToUse, 'utf8').digest();
    return this.key;
  }

  public async encrypt(plaintext: string): Promise<string> {
    if (!plaintext) return '';

    const key = this.getKey();
    const iv = randomBytes(AesGcmTokenVault.IV_LENGTH);
    const cipher = createCipheriv(AesGcmTokenVault.ALGORITHM, key, iv, {
      authTagLength: AesGcmTokenVault.AUTH_TAG_LENGTH,
    });

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:ciphertext
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  public async decrypt(encryptedPayload: string): Promise<string> {
    if (!encryptedPayload) return '';

    const parts = encryptedPayload.split(':');
    if (parts.length !== 3) {
      throw new Error('Malformed encrypted payload format. Expected iv:tag:ciphertext');
    }

    const [ivHex, tagHex, cipherHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(tagHex, 'hex');

    const key = this.getKey();
    const decipher = createDecipheriv(AesGcmTokenVault.ALGORITHM, key, iv, {
      authTagLength: AesGcmTokenVault.AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(cipherHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
}

export const defaultTokenVault: ITokenVault = new AesGcmTokenVault();
