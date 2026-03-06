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

  it("throws on retrieve with wrong key instead of returning null", async () => {
    const vault1 = new TokenVault(tempDir, encryptionKey);
    await vault1.store("tenant-1", "gmail", { accessToken: "secret" });

    const wrongKey = "abcdef0123456789abcdef0123456789";
    const vault2 = new TokenVault(tempDir, wrongKey);
    await expect(vault2.retrieve("tenant-1", "gmail")).rejects.toThrow();
  });

  it("rejects tenantId with path traversal characters", async () => {
    const vault = new TokenVault(tempDir, encryptionKey);
    await expect(
      vault.store("../../etc", "gmail", { accessToken: "test" })
    ).rejects.toThrow(/Invalid tenantId/);
    await expect(
      vault.retrieve("../other-tenant", "gmail")
    ).rejects.toThrow(/Invalid tenantId/);
    await expect(
      vault.delete("../other-tenant", "gmail")
    ).rejects.toThrow(/Invalid tenantId/);
  });

  it("rejects provider with path traversal characters", async () => {
    const vault = new TokenVault(tempDir, encryptionKey);
    await expect(
      vault.store("tenant-1", "../evil", { accessToken: "test" })
    ).rejects.toThrow(/Invalid provider/);
    await expect(
      vault.retrieve("tenant-1", "../../etc/passwd")
    ).rejects.toThrow(/Invalid provider/);
    await expect(
      vault.delete("tenant-1", "../evil")
    ).rejects.toThrow(/Invalid provider/);
  });
});
