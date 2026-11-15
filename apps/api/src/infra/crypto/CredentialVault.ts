import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Armazenamento seguro de credenciais de integração (tokens de acesso,
 * chaves de parceiros). AES-256-GCM com IV aleatório; a chave vem de
 * CREDENTIALS_ENCRYPTION_KEY e nunca é gravada no banco.
 * Formato: v1:<iv b64>:<tag b64>:<ciphertext b64>
 */
export class CredentialVault {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    const key = Buffer.from(base64Key ?? '', 'base64');
    if (key.length !== 32) {
      throw new Error('CREDENTIALS_ENCRYPTION_KEY deve conter 32 bytes em base64 (openssl rand -base64 32)');
    }
    this.key = key;
  }

  encrypt(value: Record<string, string>): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
  }

  decrypt(payload: string): Record<string, string> {
    const [v, ivB64, tagB64, ctB64] = payload.split(':');
    if (v !== 'v1' || !ivB64 || !tagB64 || !ctB64) throw new Error('Formato de credencial inválido');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]);
    return JSON.parse(pt.toString('utf8'));
  }

  /** Mostra apenas os 4 últimos caracteres (para a tela de configuração). */
  static mask(secret: string | undefined): string | null {
    if (!secret) return null;
    return secret.length <= 4 ? '****' : `****${secret.slice(-4)}`;
  }
}
