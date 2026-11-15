import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer, type Server } from "../src/app.js";

const servers: Server[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.app.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function withClient(): Server {
  const root = mkdtempSync(join(tmpdir(), "firetop-static-"));
  dirs.push(root);
  const client = join(root, "client");
  mkdirSync(join(client, "assets"), { recursive: true });
  writeFileSync(join(client, "index.html"), "<!doctype html><div id=root></div>");
  writeFileSync(join(client, "assets", "app-abc123.js"), "console.log(1)");
  writeFileSync(join(root, "secret.db"), "do not serve");
  const s = buildServer({ dbPath: ":memory:", clientDir: client, version: "abc1234", sweepIntervalMs: 0 });
  servers.push(s);
  return s;
}

describe("serving the client", () => {
  it("serves hashed assets with a long cache and routes everything else to the app shell", async () => {
    const s = withClient();
    const js = await s.app.inject({ url: "/assets/app-abc123.js" });
    expect(js.statusCode).toBe(200);
    expect(js.headers["content-type"]).toContain("text/javascript");
    expect(js.headers["cache-control"]).toContain("immutable");
    for (const url of ["/", "/online", "/play/abcDEF123#token", "/play/abcDEF123?x=1"]) {
      const page = await s.app.inject({ url });
      expect(page.statusCode).toBe(200);
      expect(page.headers["content-type"]).toContain("text/html");
      expect(page.headers["cache-control"]).toBe("no-cache");
      expect(page.body).toContain('<div id=root>');
    }
  });

  it("never serves files outside the client folder", async () => {
    const s = withClient();
    for (const url of ["/../secret.db", "/%2e%2e/secret.db", "/assets/..%2f..%2fsecret.db"]) {
      const res = await s.app.inject({ url });
      expect(res.body).not.toContain("do not serve");
    }
  });

  it("keeps unknown API paths as JSON 404s and reports the version", async () => {
    const s = withClient();
    const missing = await s.app.inject({ url: "/api/nope" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: "not_found" });
    expect((await s.app.inject({ url: "/api/health" })).json()).toMatchObject({ ok: true, version: "abc1234" });
  });
});
