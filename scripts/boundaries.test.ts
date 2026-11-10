import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function files(directory: string): Promise<string[]> {
  return (await Promise.all((await readdir(directory, { withFileTypes: true })).map((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file) : /\.tsx?$/.test(file) ? [file] : [];
  }))).flat();
}
describe("browser/server package boundary", () => {
  it("keeps Node, provider credentials and database modules outside client and shared sources", async () => {
    for (const file of [...await files("apps/client/src/components"), ...await files("apps/client/src/app"), ...await files("apps/client/src/lib"), ...await files("packages/shared/src")]) {
      if (file.endsWith(".test.ts")) continue;
      const source = await readFile(file, "utf8");
      const imports = [...source.matchAll(/(?:from\s+|import\s*\()\s*["']([^"']+)/g)].map((match) => match[1]);
      expect(imports.filter((item) => /^(node:|@openstudio\/(database|server))/.test(item) || /(?:^|\/)server\//.test(item)), file).toEqual([]);
    }
    const client = JSON.parse(await readFile("apps/client/package.json", "utf8"));
    expect(client.dependencies).not.toHaveProperty("@openstudio/database"); expect(client.dependencies).not.toHaveProperty("@openstudio/server");
  });
});
