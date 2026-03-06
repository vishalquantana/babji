import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

export class TokenVault {
  private key: Buffer;

  constructor(
    private baseDir: string,
    encryptionKey: string
  ) {
    // Key must be 32 bytes for AES-256
    this.key = Buffer.from(encryptionKey.padEnd(64, "0").slice(0, 64), "hex");
  }

  private filePath(tenantId: string, provider: string): string {
    return join(this.baseDir, tenantId, "credentials", `${provider}.enc`);
  }

  async store(tenantId: string, provider: string, data: unknown): Promise<void> {
    const dir = join(this.baseDir, tenantId, "credentials");
    await mkdir(dir, { recursive: true });

    const plaintext = JSON.stringify(data);
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);

    let encrypted = cipher.update(plaintext, "utf8");
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    const tag = cipher.getAuthTag();

    // Format: iv (16 bytes) + tag (16 bytes) + encrypted data
    const combined = Buffer.concat([iv, tag, encrypted]);
    await writeFile(this.filePath(tenantId, provider), combined);
  }

  async retrieve(tenantId: string, provider: string): Promise<unknown | null> {
    try {
      const combined = await readFile(this.filePath(tenantId, provider));
      const iv = combined.subarray(0, IV_LENGTH);
      const tag = combined.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
      const encrypted = combined.subarray(IV_LENGTH + TAG_LENGTH);

      const decipher = createDecipheriv(ALGORITHM, this.key, iv);
      decipher.setAuthTag(tag);

      let decrypted = decipher.update(encrypted);
      decrypted = Buffer.concat([decrypted, decipher.final()]);

      return JSON.parse(decrypted.toString("utf8"));
    } catch {
      return null;
    }
  }

  async delete(tenantId: string, provider: string): Promise<void> {
    try {
      await unlink(this.filePath(tenantId, provider));
    } catch {
      // Ignore if file doesn't exist
    }
  }
}
