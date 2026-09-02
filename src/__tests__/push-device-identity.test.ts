import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getOrGenerateDeviceInstanceId,
  getDeviceStorageKey,
  isValidDeviceUuid,
} from "@/lib/push/device-identity.client";

describe("P0.1D - D2.1: Device Identity Client Helper", () => {
  let mockStorage: Record<string, string> = {};
  let localStorageMock: {
    getItem: ReturnType<typeof vi.fn>;
    setItem: ReturnType<typeof vi.fn>;
    removeItem: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
  };
  let cryptoMock: {
    randomUUID: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockStorage = {};

    localStorageMock = {
      getItem: vi.fn((key: string) => mockStorage[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        mockStorage[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete mockStorage[key];
      }),
      clear: vi.fn(() => {
        mockStorage = {};
      }),
    };

    cryptoMock = {
      randomUUID: vi.fn(() => "e3f94c08-724a-4a6c-9c02-e25f82470a29"),
    };

    const windowMock = {
      localStorage: localStorageMock,
      crypto: cryptoMock,
    };

    (globalThis as unknown as { window: typeof windowMock }).window = windowMock;
  });

  it("1. eligible user generates a valid UUID v4", () => {
    const id = getOrGenerateDeviceInstanceId("user-admin-1", "admin");
    expect(id).toBe("e3f94c08-724a-4a6c-9c02-e25f82470a29");
    expect(isValidDeviceUuid(id)).toBe(true);

    const storageKey = getDeviceStorageKey("user-admin-1");
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      storageKey,
      JSON.stringify({ v: 1, id: "e3f94c08-724a-4a6c-9c02-e25f82470a29" })
    );
  });

  it("2. same user reload reuses the persisted ID", () => {
    mockStorage[getDeviceStorageKey("user-admin-1")] = JSON.stringify({
      v: 1,
      id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    });

    const id = getOrGenerateDeviceInstanceId("user-admin-1", "admin");
    expect(id).toBe("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d");
    expect(cryptoMock.randomUUID).not.toHaveBeenCalled();
  });

  it("3. different users get distinct keys and isolated IDs", () => {
    cryptoMock.randomUUID
      .mockReturnValueOnce("11111111-1111-4111-8111-111111111111")
      .mockReturnValueOnce("22222222-2222-4222-8222-222222222222");

    const idA = getOrGenerateDeviceInstanceId("user-A", "verified_link");
    const idB = getOrGenerateDeviceInstanceId("user-B", "verified_otp");

    expect(idA).toBe("11111111-1111-4111-8111-111111111111");
    expect(idB).toBe("22222222-2222-4222-8222-222222222222");

    expect(mockStorage[getDeviceStorageKey("user-A")]).toContain(idA);
    expect(mockStorage[getDeviceStorageKey("user-B")]).toContain(idB);
  });

  it("4. unauthenticated session generates no device ID", () => {
    const id = getOrGenerateDeviceInstanceId(null, null);
    expect(id).toBeNull();
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
  });

  it("5. phone_lookup session generates no device ID", () => {
    const id = getOrGenerateDeviceInstanceId("user-client-phone", "phone_lookup");
    expect(id).toBeNull();
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
  });

  it("6. corrupted or invalid stored value regenerates a fresh UUID", () => {
    mockStorage[getDeviceStorageKey("user-admin-1")] = "invalid-json-string";

    const id = getOrGenerateDeviceInstanceId("user-admin-1", "admin");
    expect(id).toBe("e3f94c08-724a-4a6c-9c02-e25f82470a29");
    expect(cryptoMock.randomUUID).toHaveBeenCalled();
  });

  it("7. localStorage getItem failure fails open (returns null, no throw)", () => {
    localStorageMock.getItem.mockImplementation(() => {
      throw new Error("SecurityError: access denied");
    });

    const id = getOrGenerateDeviceInstanceId("user-admin-1", "admin");
    expect(id).toBeNull();
  });

  it("8. localStorage setItem failure fails open (returns null, no throw)", () => {
    localStorageMock.setItem.mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    const id = getOrGenerateDeviceInstanceId("user-admin-1", "admin");
    expect(id).toBeNull();
  });

  it("9. storage failure NEVER returns an ephemeral/unpersisted ID", () => {
    localStorageMock.setItem.mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    const id = getOrGenerateDeviceInstanceId("user-admin-1", "admin");
    expect(id).toBeNull();
  });

  it("10. cross-tab reread verification ensures persisted value matches before returning", () => {
    localStorageMock.getItem
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null);

    const id = getOrGenerateDeviceInstanceId("user-admin-1", "admin");
    expect(id).toBeNull();
  });

  it("11. accessing window.localStorage property throws SecurityError fails open (returns null, no ephemeral UUID)", () => {
    const restrictedWindow = {
      get localStorage(): Storage {
        throw new Error("SecurityError: access to localStorage denied");
      },
      crypto: cryptoMock,
    };
    (globalThis as unknown as { window: typeof restrictedWindow }).window = restrictedWindow;

    const id = getOrGenerateDeviceInstanceId("user-admin-1", "admin");
    expect(id).toBeNull();
    expect(cryptoMock.randomUUID).not.toHaveBeenCalled();
  });
});
