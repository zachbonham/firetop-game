import { useEffect, useState } from "react";
import { autosave, keepUnloadable, saveData, type AutosaveStatus } from "./autosave.js";
import { Game } from "./Game.js";
import { Setup } from "./Setup.js";
import { fromSave, startSession, type Session, type SessionSetup } from "./session.js";

const STORAGE_KEY = "firetop.local.session";

function restore(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? fromSave(JSON.parse(raw)) : null;
  } catch {
    // The rules changed since this save, or it is corrupt: keep a copy on disk, then start fresh.
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) keepUnloadable(raw);
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function App() {
  const [session, setSession] = useState<Session | null>(restore);
  const [lastSetup, setLastSetup] = useState<SessionSetup | null>(session?.setup ?? null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<AutosaveStatus>(null);

  useEffect(() => {
    if (session) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saveData(session)));
      autosave(session, setSaveStatus);
    } else localStorage.removeItem(STORAGE_KEY);
  }, [session]);

  if (!session) {
    return (
      <>
        {setupError && <p className="error banner">{setupError}</p>}
        <Setup
          initial={lastSetup}
          onStart={(setup) => {
            try {
              setLastSetup(setup);
              setSession(startSession({ ...setup, startedAt: new Date().toISOString() }));
              setSetupError(null);
            } catch (e) {
              setSetupError(e instanceof Error ? e.message : String(e));
            }
          }}
          onLoad={(s) => {
            setLastSetup(s.setup);
            setSession(s);
          }}
        />
      </>
    );
  }
  return (
    <Game
      key={`${session.setup.seed}-${session.setup.startedAt}`}
      session={session}
      setSession={setSession}
      saveStatus={saveStatus}
      onNewGame={() => setSession(null)}
    />
  );
}
