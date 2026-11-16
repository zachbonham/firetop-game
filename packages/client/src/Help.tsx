import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { DEFAULT_CONFIG as C } from "@firetop/engine";
import { ABILITY, ARCHS, heroStats } from "./online/heroes.js";

/**
 * Quick help: how to win, what a turn looks like, and the few rules that surprise new
 * players. Numbers come from DEFAULT_CONFIG so they follow rule changes; docs/rules.md has
 * the full summary.
 */
export function HelpButton({ label = "? How to play" }: { label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="help-toggle" onClick={() => setOpen(true)} title="How to play">{label}</button>
      {open && createPortal(<HelpPopup onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

export function HelpPopup({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="card-overlay help-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="help-title">
      <article className="help" tabIndex={-1} ref={(el) => el?.focus()} onClick={(e) => e.stopPropagation()}>
        <h2 id="help-title">How to play</h2>

        <section>
          <h3>🎯 Goal</h3>
          <p>
            Collect keys, cross the maze, beat <b>{C.wizard.name}</b> in his lair, then open his chest with the
            right <b>{C.comboSize} of the {C.keyCount} keys</b>. The first player to open it wins.
          </p>
        </section>

        <section>
          <h3>🚀 Quick start</h3>
          <ol>
            <li><b>Roll</b> 🎲 and move up to that many squares: click a highlighted square. Entering a room, the camp or a maze tile ends your move.</li>
            <li><b>Explore rooms.</b> The first visit reveals what's inside: a monster (often guarding a key), treasure (a key or item), or a trap.</li>
            <li><b>Gather keys.</b> Keys you hold are public, so others will come for them. You only know which {C.comboSize} are right by trying the chest.</li>
            <li><b>Cross the maze</b> to the lair, beat the wizard, and <b>guess the chest</b> with {C.comboSize} of your keys.</li>
          </ol>
        </section>

        <section>
          <h3>🧝 Heroes</h3>
          <ul className="help-heroes">
            {ARCHS.map((a) => <li key={a}><b>{a}</b>: {heroStats(a)}. {sentence(ABILITY[a])}</li>)}
          </ul>
          <p className="hint"><b>Skill</b> wins fights, <b>Stamina</b> is your health, <b>Luck</b> rerolls a combat round you were losing.</p>
        </section>

        <section>
          <h3>🔁 On your turn</h3>
          <ul>
            <li><b>Items first</b> (free): eat Provisions (+{C.provisionsAmount} Stamina) or read a Scroll of Seeing to peek into a room.</li>
            <li>Then do <b>one</b>: roll and move, <b>rest</b> (+{C.restAmount} Stamina or more), <b>attack</b> a player on your square, or (in the maze) <b>re-turn</b> a tile.</li>
          </ul>
        </section>

        <section>
          <h3>⚔ Combat</h3>
          <p>
            A fight resolves in one go. Each round both sides roll 2d6 + Skill; the lower loses {C.combatDamage} Stamina.
            You flee automatically below {C.defaultFleeBelow} Stamina (fleeing costs {C.fleeDamage} and steps you back).
            Beat another player and you take one of their keys.
          </p>
          <p>
            <b>Defeated</b> (0 Stamina)? You drop your keys where you fell, wake at the Entrance (or the camp, once
            you've reached it) with half Stamina, and miss a turn.
          </p>
        </section>

        <section>
          <h3>🧩 The maze</h3>
          <p>
            Stepping onto a face-down tile ends your move: you see it, then choose how to turn it (it must open toward where you came from).
            Only you see your tiles. Stuck? Re-turn a tile instead of rolling; the game suggests one when you're boxed in.
          </p>
        </section>

        <section>
          <h3>🗝 The chest</h3>
          <p>
            In the lair you can't roll: guess, rest or leave. A wrong guess costs {C.wrongGuessDamage} Stamina and shows everyone
            your keys and how many were right, so a guess is also a clue for your rivals.
          </p>
        </section>

        <section>
          <h3>⏱ Online games</h3>
          <p>
            Play at your own pace: each turn has a deadline (set when the game is made). Miss it and the turn is skipped;
            miss {C.maxMissedTurns} in a row and you leave the game, dropping your keys.
          </p>
        </section>

        <section>
          <h3>💡 Tips</h3>
          <ul>
            <li>Rest before a big fight: Stamina decides how many lost rounds you can take before you flee.</li>
            <li>Watch wrong guesses: they narrow down the combination for everyone.</li>
            <li>The camp is a safer place to wake up after a defeat. Pass through it early.</li>
          </ul>
        </section>

        <button className="primary" onClick={onClose}>Got it</button>
      </article>
    </div>
  );
}

const sentence = (t: string) => `${t.charAt(0).toUpperCase()}${t.slice(1)}.`;
