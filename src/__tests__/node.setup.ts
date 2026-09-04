import { vi } from "vitest";

// Route handlers are invoked directly by the node test suite, outside Next's
// request lifecycle. Background callbacks are covered by dedicated push tests.
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual, after: () => undefined };
});
