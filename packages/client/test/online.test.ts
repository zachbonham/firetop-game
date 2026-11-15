import { describe, expect, it } from "vitest";
import { parsePlayUrl, timeLeft } from "../src/online/tokens.js";

const TOKEN = "48ujbPS3cxe8IJsdqDx79XYNhtx5UbQzsvqwTdz2L98";

describe("invite links", () => {
  it("reads the game id and the seat token from the fragment", () => {
    expect(parsePlayUrl("/play/qXOSoUWnE70o", `#${TOKEN}`)).toEqual({ gameId: "qXOSoUWnE70o", token: TOKEN });
    expect(parsePlayUrl("/play/qXOSoUWnE70o/", "")).toEqual({ gameId: "qXOSoUWnE70o", token: null });
  });
  it("ignores junk", () => {
    expect(parsePlayUrl("/play/", "")).toBeNull();
    expect(parsePlayUrl("/play/a/b", "")).toBeNull();
    expect(parsePlayUrl("/play/bad id!", "")).toBeNull();
    expect(parsePlayUrl("/play/abc", "#short")).toEqual({ gameId: "abc", token: null });
    expect(parsePlayUrl("/play/abc", "#<script>")).toEqual({ gameId: "abc", token: null });
  });
});

describe("turn countdown", () => {
  const now = Date.parse("2026-11-15T12:00:00Z");
  const at = (ms: number) => new Date(now + ms).toISOString();
  it("reads naturally", () => {
    expect(timeLeft(at(24 * 3600_000), now)).toBe("in 1d 0h");
    expect(timeLeft(at(3 * 24 * 3600_000 - 60_000), now)).toBe("in 2d 23h");
    expect(timeLeft(at(90 * 60_000), now)).toBe("in 1h 30m");
    expect(timeLeft(at(30_000), now)).toBe("in 1m");
    expect(timeLeft(at(-1000), now)).toBe("overdue");
  });
});
