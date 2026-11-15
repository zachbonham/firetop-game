import { useEffect, useState } from "react";
import { Game } from "./Game.js";
import { Setup } from "./Setup.js";
import { fromSave, startSession, toSave, type Session, type SessionSetup } from "./session.js";

const STORAGE_KEY = "firetop.local.session";

function restore(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? fromSave(JSON.parse(raw)) : null;
  } catch {
    // The rules changed since this save (actions no longer replay) or it is corrupt: start fresh.
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function App() {
  const [session, setSession] = useState<Session | null>(restore);
  const [lastSetup, setLastSetup] = useState<SessionSetup | null>(session?.setup ?? null);
  const [setupError, setSetupError] = useState<string | null>(null);

  useEffect(() => {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave(session)));
    else localStorage.removeItem(STORAGE_KEY);
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
              setSession(startSession(setup));
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
  return <Game key={session.setup.seed} session={session} setSession={setSession} onNewGame={() => setSession(null)} />;
}
