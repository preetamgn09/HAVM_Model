import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, get, post } from "../api";

const respond = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue(new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));

afterEach(() => vi.unstubAllGlobals());

describe("API client", () => {
  it("returns parsed JSON on success", async () => {
    vi.stubGlobal("fetch", respond(200, { data: { ok: true }, meta: {} }));
    await expect(get("/api/health")).resolves.toEqual({ data: { ok: true }, meta: {} });
  });
  it("surfaces the server's error envelope", async () => {
    vi.stubGlobal("fetch", respond(409, { error: { code: "replay_busy", message: "A replay is already running." } }));
    const err = await post("/api/replay", {}).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.code).toBe("replay_busy");
    expect(err.message).toBe("A replay is already running.");
  });
  it("handles non-JSON error bodies", async () => {
    vi.stubGlobal("fetch", respond(502, "<html>bad gateway</html>"));
    const err = await get("/api/overview").catch((e) => e);
    expect(err.status).toBe(502);
    expect(err.message).toContain("502");
  });
  it("reports an unreachable server clearly", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const err = await get("/api/overview").catch((e) => e);
    expect(err.code).toBe("network");
  });
});
