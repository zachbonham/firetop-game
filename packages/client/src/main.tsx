import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { Lobby } from "./online/Lobby.js";
import { Play } from "./online/Play.js";
import "./styles.css";

/**
 * Routes (no router library: there are only three pages):
 *   /online            online games: create one, invite links, your games
 *   /play/<id>#<seat>  an online game (the invite link)
 *   anything else      the local hot-seat test board
 */
function Root() {
  const path = window.location.pathname;
  if (path === "/online" || path === "/online/") {
    document.title = "Firetop – online";
    return <Lobby />;
  }
  if (path.startsWith("/play/")) {
    document.title = "Firetop – game";
    return <Play />;
  }
  return <App />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
