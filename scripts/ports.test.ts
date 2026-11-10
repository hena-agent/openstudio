import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { listenInRange } from "./ports";

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))); });
describe("application ports", () => {
  it("serves localhost over IPv4 and IPv6 on the same loopback port", async () => {
    const handler: import("node:http").RequestListener = (_request, response) => response.writeHead(204).end();
    const ipv4 = createServer(handler), ipv6 = createServer(handler); servers.push(ipv4, ipv6);
    const port = await listenInRange(ipv4, 3001, 3999, ipv6);
    for (const host of ["127.0.0.1", "[::1]", "localhost"]) expect((await fetch(`http://${host}:${port}`)).status).toBe(204);
  });
  it("releases IPv4 when the matching IPv6 port is already occupied", async () => {
    const occupied = createServer(), ipv4 = createServer(), ipv6 = createServer(); servers.push(occupied, ipv4, ipv6);
    await new Promise<void>((resolve) => occupied.listen({ host: "::1", port: 0, ipv6Only: true }, resolve));
    const port = (occupied.address() as import("node:net").AddressInfo).port;
    await expect(listenInRange(ipv4, port, port, ipv6)).rejects.toThrow("사용 가능한 포트");
    expect(ipv4.listening).toBe(false); expect(occupied.listening).toBe(true);
  });
  it("skips browser-restricted ports inside the development ranges", async () => {
    const server = createServer(); servers.push(server);
    await expect(listenInRange(server, 3659, 3659)).rejects.toThrow("사용 가능한 포트");
    await expect(listenInRange(server, 4045, 4045)).rejects.toThrow("사용 가능한 포트");
    expect(server.listening).toBe(false);
  });
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
