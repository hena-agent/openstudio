import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadMedia, referenceData, saveMedia, serveAsset, validateDownloadURL } from "./assets";

let directory: string;
const alice = "a".repeat(64), bob = "b".repeat(64);
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), "studio-assets-")); vi.stubEnv("OPENSTUDIO_DATA_DIR", directory); vi.stubEnv("OPENSTUDIO_ENCRYPTION_KEY", "c".repeat(64)); });
afterEach(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); await rm(directory, { recursive: true, force: true }); });
describe("private media assets", () => {
  it("checks MIME bytes, isolates sessions and serves valid byte ranges", async () => {
    const asset = await saveMedia(alice, new Response(png), "image", "reference.png");
    const request = (session: string, range?: string) => new Request(`http://127.0.0.1/api/assets?id=${asset.id}`, { headers: { Cookie: `studio_session=${session}`, ...(range ? { Range: range } : {}) } });
    expect((await serveAsset(request(bob))).status).toBe(404);
    const response = await serveAsset(request(alice, "bytes=0-3"));
    expect(response.status).toBe(206); expect(response.headers.get("content-range")).toBe("bytes 0-3/12");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png.subarray(0, 4));
    expect((await serveAsset(request(alice, "bytes=99-100"))).status).toBe(416);
    expect(await referenceData(alice, asset.id)).toMatch(/^data:image\/png;base64,/);
    await expect(referenceData(bob, asset.id)).rejects.toMatchObject({ status: 404 });
  });
  it("rejects HTML/SVG disguised as image media and arbitrary download targets", async () => {
    await expect(saveMedia(alice, new Response("<svg><script>bad</script></svg>"), "image", "bad.png")).rejects.toMatchObject({ code: "invalid_media" });
    for (const url of ["http://127.0.0.1/secret", "https://fal.media.evil.test/file", "https://evil.test/file", "https://user:pass@fal.media/file"]) expect(() => validateDownloadURL(url)).toThrow();
    expect(validateDownloadURL("https://v3b.fal.media/file.mp4").hostname).toBe("v3b.fal.media");
  });
  it("never forwards provider credentials to a redirected CDN host", async () => {
    const send = vi.fn().mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: "https://v3.fal.media/result.png" } })).mockResolvedValueOnce(new Response(png));
    vi.stubGlobal("fetch", send);
    const asset = await downloadMedia(alice, "https://openrouter.ai/api/v1/videos/remote/content", "image", "result", { Authorization: "Bearer private-token" });
    expect(asset.name).toBe("result.png");
    expect(send.mock.calls[0][1].headers.Authorization).toBe("Bearer private-token");
    expect(send.mock.calls[1][1].headers).toEqual({});
  });
});
