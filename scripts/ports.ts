import { randomInt } from "node:crypto";
import type { Server } from "node:http";

// Bind the real listener, rather than probing then releasing a port (TOCTOU).
export async function listenInRange(server: Server, first: number, last: number): Promise<number> {
  const offset = randomInt(last - first + 1);
  for (let index = 0; index <= last - first; index++) {
    const port = first + (offset + index) % (last - first + 1);
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: NodeJS.ErrnoException) => reject(error);
        server.once("error", onError);
        server.listen(port, "127.0.0.1", () => { server.off("error", onError); resolve(); });
      });
      return port;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
    }
  }
  throw new Error(`${first}–${last} 범위에 사용 가능한 포트가 없습니다.`);
}
