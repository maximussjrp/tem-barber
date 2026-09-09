import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "crypto";
import {
  encryptMetaCredential,
  decryptMetaCredential,
  generateRegistrationPin,
  generateOnboardingNonce,
  hashOnboardingNonce,
  verifyMetaWebhookSignature,
  generateAppSecretProof,
} from "@/lib/meta/crypto";
import { getEncryptionKey } from "@/lib/meta/config";

describe("Meta Crypto Module", () => {
  const originalEnv = process.env;
  const testKeyHex =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  beforeAll(() => {
    process.env = {
      ...originalEnv,
      META_CREDENTIAL_ENCRYPTION_ACTIVE_VERSION: "v1",
      META_CREDENTIAL_ENCRYPTION_KEY_V1: testKeyHex,
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("AES-256-GCM Encryption / Decryption", () => {
    const barbershopId = "barber_123";
    const metaConnectionId = "conn_456";
    const credentialType = "REGISTRATION_PIN";
    const plainPin = "654321";

    it("encrypts and decrypts credential successfully with matching AAD", () => {
      const encrypted = encryptMetaCredential({
        plaintext: plainPin,
        barbershopId,
        metaConnectionId,
        credentialType,
      });

      expect(encrypted.ciphertext).toBeDefined();
      expect(encrypted.iv).toHaveLength(24); // 12 bytes = 24 hex chars
      expect(encrypted.authTag).toHaveLength(32); // 16 bytes = 32 hex chars
      expect(encrypted.keyVersion).toBe("v1");

      const decrypted = decryptMetaCredential({
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        keyVersion: encrypted.keyVersion,
        barbershopId,
        metaConnectionId,
        credentialType,
      });

      expect(decrypted).toBe(plainPin);
    });

    it("fails decryption if barbershopId in AAD is mismatched (cross-tenant prevention)", () => {
      const encrypted = encryptMetaCredential({
        plaintext: plainPin,
        barbershopId: "tenant_A",
        metaConnectionId,
        credentialType,
      });

      expect(() => {
        decryptMetaCredential({
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          keyVersion: encrypted.keyVersion,
          barbershopId: "tenant_B", // Mismatch
          metaConnectionId,
          credentialType,
        });
      }).toThrow();
    });

    it("fails decryption if metaConnectionId in AAD is mismatched", () => {
      const encrypted = encryptMetaCredential({
        plaintext: plainPin,
        barbershopId,
        metaConnectionId: "conn_1",
        credentialType,
      });

      expect(() => {
        decryptMetaCredential({
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          keyVersion: encrypted.keyVersion,
          barbershopId,
          metaConnectionId: "conn_2", // Mismatch
          credentialType,
        });
      }).toThrow();
    });

    it("fails decryption if ciphertext is tampered", () => {
      const encrypted = encryptMetaCredential({
        plaintext: plainPin,
        barbershopId,
        metaConnectionId,
        credentialType,
      });

      // Tamper ciphertext
      const tamperedCiphertext =
        encrypted.ciphertext.slice(0, -2) +
        (encrypted.ciphertext.endsWith("0") ? "1" : "0");

      expect(() => {
        decryptMetaCredential({
          ciphertext: tamperedCiphertext,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          keyVersion: encrypted.keyVersion,
          barbershopId,
          metaConnectionId,
          credentialType,
        });
      }).toThrow();
    });

    it("fails decryption if authTag is tampered", () => {
      const encrypted = encryptMetaCredential({
        plaintext: plainPin,
        barbershopId,
        metaConnectionId,
        credentialType,
      });

      const tamperedAuthTag =
        encrypted.authTag.slice(0, -1) +
        (encrypted.authTag.endsWith("0") ? "1" : "0");

      expect(() => {
        decryptMetaCredential({
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
          authTag: tamperedAuthTag,
          keyVersion: encrypted.keyVersion,
          barbershopId,
          metaConnectionId,
          credentialType,
        });
      }).toThrow();
    });
  });

  describe("Registration PIN Generator", () => {
    it("generates 6-digit numeric strings", () => {
      for (let i = 0; i < 50; i++) {
        const pin = generateRegistrationPin();
        expect(pin).toMatch(/^\d{6}$/);
        expect(pin.length).toBe(6);
      }
    });
  });

  describe("Onboarding Nonce Generation and Hashing", () => {
    it("generates unique 64-character hex nonce and SHA-256 hash", () => {
      const nonce1 = generateOnboardingNonce();
      const nonce2 = generateOnboardingNonce();

      expect(nonce1).toHaveLength(64);
      expect(nonce2).toHaveLength(64);
      expect(nonce1).not.toBe(nonce2);

      const hash1 = hashOnboardingNonce(nonce1);
      const hash2 = hashOnboardingNonce(nonce2);

      expect(hash1).toHaveLength(64);
      expect(hash1).toBe(
        crypto.createHash("sha256").update(nonce1).digest("hex")
      );
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("Webhook HMAC-SHA256 Signature Verification", () => {
    const appSecret = "meta_app_secret_123456";
    const body = JSON.stringify({ object: "whatsapp_business_account" });

    it("validates valid signature", () => {
      const hmac = crypto
        .createHmac("sha256", appSecret)
        .update(body)
        .digest("hex");
      const header = `sha256=${hmac}`;

      const isValid = verifyMetaWebhookSignature(body, header, appSecret);
      expect(isValid).toBe(true);
    });

    it("rejects invalid signature", () => {
      const header = `sha256=${"a".repeat(64)}`;
      const isValid = verifyMetaWebhookSignature(body, header, appSecret);
      expect(isValid).toBe(false);
    });

    it("rejects missing signature or missing secret", () => {
      expect(verifyMetaWebhookSignature(body, null, appSecret)).toBe(false);
      expect(verifyMetaWebhookSignature(body, "", appSecret)).toBe(false);
      expect(verifyMetaWebhookSignature(body, "sha256=123", "")).toBe(false);
    });

    it("rejects non-sha256 formatted signature", () => {
      expect(
        verifyMetaWebhookSignature(body, "md5=invalid_prefix", appSecret)
      ).toBe(false);
    });
  });

  describe("AppSecret Proof Generation", () => {
    it("generates correct hmac-sha256 proof", () => {
      const token = "EAAtest_token_123";
      const secret = "secret_abc";
      const proof = generateAppSecretProof(token, secret);

      const expected = crypto
        .createHmac("sha256", secret)
        .update(token)
        .digest("hex");
      expect(proof).toBe(expected);
    });
  });

  describe("Encryption Key Encoding & Resolution", () => {
    it("accepts valid 64-char Hex key (32 bytes)", () => {
      process.env.META_CREDENTIAL_ENCRYPTION_KEY_TEST_HEX =
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
      const key = getEncryptionKey("test_hex");
      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
    });

    it("accepts valid Base64 key decoding to 32 bytes", () => {
      const rawBytes = Buffer.from(
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        "hex"
      );
      process.env.META_CREDENTIAL_ENCRYPTION_KEY_TEST_B64 = rawBytes.toString("base64");
      const key = getEncryptionKey("test_b64");
      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
      expect(key.equals(rawBytes)).toBe(true);
    });

    it("prohibits raw 32-character UTF-8 key", () => {
      // 32-character plain ascii string that is not hex and not 32-byte base64
      process.env.META_CREDENTIAL_ENCRYPTION_KEY_TEST_UTF8 =
        "12345678901234567890123456789012";
      expect(() => getEncryptionKey("test_utf8")).toThrow(/must be explicitly encoded/);
    });

    it("rejects invalid key length or format", () => {
      process.env.META_CREDENTIAL_ENCRYPTION_KEY_TEST_INVALID = "short_invalid_key";
      expect(() => getEncryptionKey("test_invalid")).toThrow(/must be explicitly encoded/);
    });
  });
});
