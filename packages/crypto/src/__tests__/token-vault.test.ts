import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TokenVault } from "../token-vault.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("TokenVault", () => {
  let tempDir: string;
  const encryptionKey = "0123456789abcdef0123456789abcdef"; // 32 hex chars = 16 bytes for testing

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "babji-vault-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("encrypts and decrypts a token", async () => {
    const vault = new TokenVault(tempDir, encryptionKey);
    const tokenData = {
      accessToken: "ya29.some-google-token",
      refreshToken: "1//some-refresh-token",
      expiresAt: Date.now() + 3600000,
    };

    await vault.store("tenant-1", "gmail", tokenData);
    const retrieved = await vault.retrieve("tenant-1", "gmail");
    expect(retrieved).toEqual(tokenData);
  });

  it("returns null for non-existent token", async () => {
    const vault = new TokenVault(tempDir, encryptionKey);
    const result = await vault.retrieve("tenant-1", "nonexistent");
    expect(result).toBeNull();
  });

  it("deletes a token", async () => {
    const vault = new TokenVault(tempDir, encryptionKey);
    await vault.store("tenant-1", "gmail", { accessToken: "test" });
    await vault.delete("tenant-1", "gmail");
    const result = await vault.retrieve("tenant-1", "gmail");
    expect(result).toBeNull();
  });
});
