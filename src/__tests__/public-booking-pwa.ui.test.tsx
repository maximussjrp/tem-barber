import React from "react";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AgendasPage from "@/app/[slug]/agendar/page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "don-brio" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next-auth/react", () => ({
  signIn: vi.fn(),
  useSession: () => ({ data: null }),
}));

describe("agenda publica PWA", () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = "lastBarbershopSlug=; Max-Age=0; Path=/";
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ categories: [], members: [] }),
    }) as unknown as typeof fetch;
  });

  it("salva slug da barbearia ao acessar /[slug]/agendar", async () => {
    render(<AgendasPage />);

    await waitFor(() => {
      expect(localStorage.getItem("lastBarbershopSlug")).toBe("don-brio");
    });
    expect(document.cookie).toContain("lastBarbershopSlug=don-brio");
  });
});
