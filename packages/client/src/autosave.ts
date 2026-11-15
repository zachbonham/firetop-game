import { sessionName, toSave, type Session } from "./session.js";

/** Commit of this build, recorded in saves to help replay old games. */
export const BUILD_COMMIT = typeof __GIT_COMMIT__ === "string" ? __GIT_COMMIT__ : "unknown";

export function saveData(session: Session) {
  return toSave(session, { commit: BUILD_COMMIT, savedAt: new Date().toISOString() });
}

export type AutosaveStatus = { ok: true; path: string } | { ok: false; error: string } | null;

/** Write a save that no longer loads (e.g. older rules) to playtests/autosave/ so it isn't lost. */
export function keepUnloadable(raw: string) {
  if (!import.meta.env.DEV) return;
  const name = `unloadable-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  void fetch(`/__autosave/${name}`, { method: "POST", body: raw }).catch(() => undefined);
}

let timer: ReturnType<typeof setTimeout> | undefined;

/**
 * Write the session to playtests/autosave/ through the dev server (debounced).
 * Does nothing in a production build, where there is no dev server to write to.
 */
export function autosave(session: Session, onDone: (s: AutosaveStatus) => void) {
  if (!import.meta.env.DEV) return;
  clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      const res = await fetch(`/__autosave/${encodeURIComponent(sessionName(session.setup))}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(saveData(session), null, 1),
      });
      const text = await res.text();
      onDone(res.ok ? { ok: true, path: text } : { ok: false, error: text });
    } catch (e) {
      onDone({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }, 500);
}
