import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

export interface ITokenVault {
  encrypt(plaintext: string): Promise<string>;
  decrypt(ciphertext: string): Promise<string>;
}

export class AesGcmTokenVault implements ITokenVault {
  private readonly key: Buffer;
  private static readonly ALGORITHM = 'aes-256-gcm';
  private static readonly IV_LENGTH = 12; // Standard 96-bit IV for GCM
  private static readonly AUTH_TAG_LENGTH = 16;

  constructor(secretKey?: string) {
    const rawSecret =
      secretKey ||
      process.env.TOKEN_ENCRYPTION_KEY ||
      process.env.AUTH_SECRET ||
      'dev-encryption-key-do-not-use-in-production-randomayzer-2026';

    if (process.env.NODE_ENV === 'production' && !process.env.TOKEN_ENCRYPTION_KEY) {
      console.warn(
        '[SECURITY WARNING] TOKEN_ENCRYPTION_KEY is not set in production. Using fallback secret.'
      );
    }

    // Derive strict 32-byte (256-bit) key via SHA-256
    this.key = createHash('sha256').update(rawSecret, 'utf8').digest();
  }

  public async encrypt(plaintext: string): Promise<string> {
    if (!plaintext) return '';

    const iv = randomBytes(AesGcmTokenVault.IV_LENGTH);
    const cipher = createCipheriv(AesGcmTokenVault.ALGORITHM, this.key, iv, {
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

    const decipher = createDecipheriv(AesGcmTokenVault.ALGORITHM, this.key, iv, {
      authTagLength: AesGcmTokenVault.AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(cipherHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
}

export const defaultTokenVault: ITokenVault = new AesGcmTokenVault();
