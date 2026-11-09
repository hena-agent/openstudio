import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { listenInRange } from "./ports";

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))); });
describe("application ports", () => {
  it("binds actual independent listeners in 3xxx and 4xxx ranges", async () => {
    const front = createServer(), back = createServer();
    servers.push(front, back);
    const first = await listenInRange(front, 3001, 3999);
    const second = await listenInRange(back, 4001, 4999);
    expect(first).toBeGreaterThan(3000); expect(first).toBeLessThan(4000);
    expect(second).toBeGreaterThan(4000); expect(second).toBeLessThan(5000);
    expect(front.listening && back.listening).toBe(true);
    const collision = createServer(); servers.push(collision);
    await expect(listenInRange(collision, first, first)).rejects.toThrow("사용 가능한 포트");
  });
});
