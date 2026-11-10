import { randomInt } from "node:crypto";
import type { Server } from "node:http";

// Bind the real listener, rather than probing then releasing a port (TOCTOU).
export async function listenInRange(server: Server, first: number, last: number, ipv6?: Server): Promise<number> {
  const offset = randomInt(last - first + 1);
  for (let index = 0; index <= last - first; index++) {
    const port = first + (offset + index) % (last - first + 1);
    // Chromium/Firefox block these service ports even on loopback.
    if (port === 3659 || port === 4045) continue;
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: NodeJS.ErrnoException) => reject(error);
        server.once("error", onError);
        server.listen(port, "127.0.0.1", () => { server.off("error", onError); resolve(); });
      });
      if (ipv6) await new Promise<void>((resolve, reject) => {
        const onError = (error: NodeJS.ErrnoException) => reject(error);
        ipv6.once("error", onError);
        ipv6.listen({ port, host: "::1", ipv6Only: true }, () => { ipv6.off("error", onError); resolve(); });
      });
      return port;
    } catch (error) {
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
    }
  }
  throw new Error(`${first}–${last} 범위에 사용 가능한 포트가 없습니다.`);
}
