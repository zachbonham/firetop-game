import { BOARD, CAMP, ENTRANCE, LAIR, MAZE_SQUARE, isMazeTile, locationOf } from "./board.js";
import { resolveCombat, type Fighter } from "./combat.js";
import { ENTRY_ROW, openings, parseTile, tileAt, tileKey } from "./maze.js";
import { ITEM_NAMES, USABLE_ITEMS, describeEncounter } from "./items.js";
import { reachable } from "./movement.js";
import { Rng } from "./rng.js";
import type { Action, ActionResult, Actor, GameState, ItemId, NodeId, Player } from "./types.js";

/**
 * The engine's single entry point: (state, actor, action) -> new state.
 * The input state is never mutated. All randomness comes from state.rng.
 */
export function applyAction(state: GameState, actor: Actor, action: Action): ActionResult {
  const s = structuredClone(state);
  const rng = new Rng(s.rng);
  try {
    const err = dispatch(s, rng, actor, action);
    if (err) return { ok: false, error: err };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  s.rng = rng.state;
  return { ok: true, state: s };
}

export function currentPlayer(s: GameState): Player {
  return s.players[s.currentIndex]!;
}

function dispatch(s: GameState, rng: Rng, actor: Actor, a: Action): string | null {
  if (s.phase === "finished") return "game is finished";

  if (a.type === "setSettings") {
    const p = s.players.find((x) => x.id === actor);
    if (!p) return "unknown player";
    if (a.settings.fleeBelow !== undefined) {
      if (!Number.isInteger(a.settings.fleeBelow) || a.settings.fleeBelow < 0) return "fleeBelow must be a whole number >= 0";
      p.settings.fleeBelow = a.settings.fleeBelow;
    }
    if (a.settings.autoLuck !== undefined) p.settings.autoLuck = !!a.settings.autoLuck;
    return null;
  }

  if (a.type === "timeout") {
    if (actor !== "system") return "only the server can time out a turn";
    return timeout(s);
  }

  const p = currentPlayer(s);
  if (actor !== p.id) return "not your turn";
  p.missedTurns = 0;

  switch (a.type) {
    case "roll": {
      if (s.phase !== "roll") return "already rolled";
      if (p.pos === LAIR) return "in the lair: guess the chest, rest or leave";
      const roll = rng.d6();
      s.pendingRoll = roll;
      s.phase = "move";
      log(s, "roll", `${p.name} rolled ${roll}.`, p.id);
      if (reachable(s, p, roll).size === 0) {
        log(s, "stuck", `${p.name} has nowhere to move.`, p.id);
        endTurn(s);
      }
      return null;
    }
    case "move":
      return move(s, rng, p, a);
    case "attack": {
      if (s.phase !== "roll") return "you can only attack instead of rolling";
      const target = s.players.find((x) => x.id === a.target);
      if (!target || target.status !== "active" || target.id === p.id) return "invalid attack target";
      if (target.pos !== p.pos) return "that player isn't on your square";
      if (isMazeTile(p.pos)) return "you can't fight inside the maze";
      if (target.protected) return "that player is protected until their next turn";
      playerFight(s, rng, p, target, a.stealKey);
      endTurn(s);
      return null;
    }
    case "rest": {
      if (s.phase !== "roll") return "you can only rest instead of rolling";
      const arch = s.config.archetypes[p.archetype];
      const before = p.stamina;
      p.stamina = Math.min(p.maxStamina, p.stamina + s.config.restAmount + (arch.restBonus ?? 0));
      const luckBefore = p.luck;
      if (p.luck < arch.luck) p.luck = Math.min(arch.luck, p.luck + (arch.luckOnRest ?? 0));
      const luck = p.luck > luckBefore ? `, +${p.luck - luckBefore} Luck` : "";
      log(s, "rest", `${p.name} rested (+${p.stamina - before} Stamina${luck}).`, p.id);
      endTurn(s);
      return null;
    }
    case "leaveLair": {
      if (s.phase !== "roll") return "you can only leave instead of rolling";
      if (p.pos !== LAIR) return "not in the lair";
      p.pos = MAZE_SQUARE;
      p.wizardBeaten = false;
      log(s, "leaveLair", `${p.name} left the lair.`, p.id);
      endTurn(s);
      return null;
    }
    case "rotateTile": {
      if (s.phase !== "roll") return "you can only turn a tile instead of rolling";
      if (!validRotation(a.rotation)) return "rotation must be 0-3";
      if (!canTurnTile(p, a.row, a.col)) return "you can only turn a revealed tile you stand on or next to";
      p.maze[tileKey(a.row, a.col)] = a.rotation;
      log(s, "rotate", `${p.name} turned a maze tile.`, p.id);
      endTurn(s);
      return null;
    }
    case "orientTile": {
      if (s.phase !== "orient" || !s.pendingFlip) return "no tile to turn";
      if (!validRotation(a.rotation)) return "rotation must be 0-3";
      const { row, col, entrySide } = s.pendingFlip;
      if (!(openings(tileAt(s.mazeTiles, row, col), a.rotation) & entrySide)) {
        return "the tile must open toward the side you entered from";
      }
      p.maze[tileKey(row, col)] = a.rotation;
      s.pendingFlip = null;
      endTurn(s);
      return null;
    }
    case "guessChest":
      return guessChest(s, p, a.keys);
    case "useItem":
      return useItem(s, p, a.item, a.room);
  }
  return "unknown action";
}

/** A free action at the start of your turn: does not end it. */
function useItem(s: GameState, p: Player, item: ItemId, room?: string): string | null {
  if (s.phase !== "roll") return "you can only use items before rolling";
  if (!p.items.includes(item)) return "you don't have that item";
  if (!USABLE_ITEMS.includes(item)) return `the ${ITEM_NAMES[item]} works automatically`;
  if (item === "provisions") {
    if (p.stamina >= p.maxStamina) return "you are already at full Stamina";
    const before = p.stamina;
    p.stamina = Math.min(p.maxStamina, p.stamina + s.config.provisionsAmount);
    log(s, "item", `${p.name} ate provisions (+${p.stamina - before} Stamina).`, p.id);
  } else {
    const rs = room !== undefined ? s.rooms[room] : undefined;
    if (!rs || room === undefined) return "choose a room to look into";
    if (rs.revealed || p.peeks.includes(room)) return "you already know what is in that room";
    p.peeks.push(room);
    log(s, "item", `${p.name} read a scroll.`, p.id);
    log(s, "peek", `The scroll shows ${room.toUpperCase()} holds ${describeEncounter(rs.encounter)}.`, p.id, p.id);
  }
  p.items.splice(p.items.indexOf(item), 1);
  return null;
}

function canTurnTile(p: Player, row: number, col: number): boolean {
  if (!(tileKey(row, col) in p.maze)) return false;
  if (p.pos === MAZE_SQUARE) return row === ENTRY_ROW && col === 0;
  if (!isMazeTile(p.pos)) return false;
  const [r, c] = parseTile(p.pos);
  return Math.abs(r - row) + Math.abs(c - col) <= 1;
}

function validRotation(r: unknown): r is number {
  return Number.isInteger(r) && (r as number) >= 0 && (r as number) <= 3;
}

function move(
  s: GameState,
  rng: Rng,
  p: Player,
  a: Extract<Action, { type: "move" }>,
): string | null {
  if (s.phase !== "move" || s.pendingRoll === null) return "roll first";
  const options = reachable(s, p, s.pendingRoll);
  const reach = options.get(a.to);
  if (!reach) return "you can't reach that square";

  if (a.attack !== undefined) {
    const target = s.players.find((x) => x.id === a.attack);
    if (!target || target.status !== "active" || target.id === p.id) return "invalid attack target";
    if (target.pos !== a.to) return "attack target isn't on that square";
    if (target.protected) return "that player is protected until their next turn";
  }

  if (reach.flip) {
    // Step onto the face-down tile; the player sees it and then picks a rotation.
    const [r, c] = parseTile(a.to);
    p.pos = a.to;
    s.pendingFlip = { row: r, col: c, entrySide: reach.entrySide! };
    s.phase = "orient";
    s.pendingRoll = null;
    log(s, "flip", `${p.name} flipped a ${tileAt(s.mazeTiles, r, c)} tile.`, p.id, p.id);
    log(s, "move", `${p.name} moved deeper into the maze.`, p.id);
    return null;
  }

  const startLoc = locationOf(p.pos);
  p.pos = a.to;
  const loc = locationOf(a.to);
  const enteredNewLocation = loc !== null && loc !== startLoc;
  log(s, "move", `${p.name} moved ${reach.dist} square${reach.dist === 1 ? "" : "s"}.`, p.id);

  let stillHere = true;
  if (enteredNewLocation && loc === "camp" && !p.campReached) {
    p.campReached = true;
    log(s, "camp", `${p.name} reached the camp: defeats now wake them here.`, p.id);
  }
  if (enteredNewLocation && loc && loc.startsWith("r")) {
    stillHere = roomEncounter(s, rng, p, loc, reach.parent);
  } else if (a.to === LAIR && !p.wizardBeaten) {
    stillHere = wizardDuel(s, rng, p);
  }

  if (stillHere && p.pos === a.to) pickUpDropped(s, p);

  if (stillHere && a.attack !== undefined && p.pos === a.to && (s.phase as string) !== "finished") {
    const target = s.players.find((x) => x.id === a.attack)!;
    if (target.status === "active" && target.pos === a.to && !target.protected) {
      playerFight(s, rng, p, target, a.stealKey);
    }
  }

  if ((s.phase as string) !== "finished") endTurn(s);
  return null;
}

/** Combat stats for a player. The sword only helps against monsters and the wizard. */
function fighterOf(s: GameState, p: Player, vsMonster: boolean): Fighter {
  const sword = vsMonster && p.items.includes("sword") ? s.config.items.swordSkill : 0;
  return {
    skill: p.skill + sword,
    stamina: p.stamina,
    luck: p.luck,
    fleeBelow: p.settings.fleeBelow,
    autoLuck: p.settings.autoLuck,
    block: p.items.includes("shield") ? s.config.items.shieldBlock : 0,
  };
}

function applyFighter(p: Player, f: Fighter) {
  p.stamina = f.stamina;
  p.luck = f.luck;
}

/** Returns false if the player left the square (fled or was defeated). */
function roomEncounter(s: GameState, rng: Rng, p: Player, room: string, from: NodeId): boolean {
  const rs = s.rooms[room];
  if (!rs || rs.cleared) return true;
  rs.revealed = true;
  const enc = rs.encounter;

  if (enc.kind === "empty") {
    rs.cleared = true;
    log(s, "room", `${p.name} found an empty room.`, p.id);
    return true;
  }
  if (enc.kind === "trap") {
    rs.cleared = true;
    p.stamina = Math.max(0, p.stamina - enc.damage);
    log(s, "trap", `${p.name} sprang a trap (-${enc.damage} Stamina).`, p.id);
    if (p.stamina <= 0) {
      defeat(s, p);
      return false;
    }
    return true;
  }
  if (enc.kind === "treasure") {
    rs.cleared = true;
    if (enc.key !== null) {
      p.keys.push(enc.key);
      log(s, "treasure", `${p.name} found key ${enc.key}.`, p.id);
    }
    if (enc.item === "skillPotion") {
      p.skill += s.config.items.skillPotion;
      log(s, "treasure", `${p.name} drank a Potion of Skill (+${s.config.items.skillPotion} Skill).`, p.id);
    } else if (enc.item === "luckPotion") {
      p.luck += s.config.items.luckPotion;
      log(s, "treasure", `${p.name} drank a Potion of Luck (+${s.config.items.luckPotion} Luck).`, p.id);
    } else {
      p.items.push(enc.item);
      log(s, "treasure", `${p.name} found the ${ITEM_NAMES[enc.item]}.`, p.id);
    }
    return true;
  }

  // Monster
  const monster: Fighter = { skill: enc.skill, stamina: enc.stamina, luck: 0, fleeBelow: null, autoLuck: false };
  const res = resolveCombat(fighterOf(s, p, true), monster, rng, s.config.combatDamage, s.config.fleeDamage);
  applyFighter(p, res.a);
  enc.stamina = res.b.stamina;
  if (res.winner === "a") {
    rs.cleared = true;
    const loot = enc.loot !== null ? ` and took key ${enc.loot}` : "";
    if (enc.loot !== null) p.keys.push(enc.loot);
    log(s, "combat", `${p.name} defeated the ${enc.name} in ${res.rounds} rounds${loot}.`, p.id);
    return true;
  }
  if (res.fled === "a") {
    p.pos = from;
    log(s, "combat", `${p.name} fled from the ${enc.name}.`, p.id);
    return false;
  }
  log(s, "combat", `${p.name} was defeated by the ${enc.name}.`, p.id);
  defeat(s, p);
  return false;
}

function wizardDuel(s: GameState, rng: Rng, p: Player): boolean {
  const w = s.config.wizard;
  const res = resolveCombat(
    fighterOf(s, p, true),
    { skill: w.skill, stamina: w.stamina, luck: 0, fleeBelow: null, autoLuck: false },
    rng,
    s.config.combatDamage,
    s.config.fleeDamage,
  );
  applyFighter(p, res.a);
  if (res.winner === "a") {
    p.wizardBeaten = true;
    log(s, "wizard", `${p.name} defeated ${w.name}!`, p.id);
    return true;
  }
  if (res.fled === "a") {
    p.pos = MAZE_SQUARE;
    log(s, "wizard", `${p.name} fled from ${w.name} back to the maze entrance.`, p.id);
    return false;
  }
  log(s, "wizard", `${p.name} was defeated by ${w.name}.`, p.id);
  defeat(s, p);
  return false;
}

function playerFight(s: GameState, rng: Rng, attacker: Player, defender: Player, stealKey?: number) {
  const res = resolveCombat(fighterOf(s, attacker, false), fighterOf(s, defender, false), rng, s.config.combatDamage, s.config.fleeDamage);
  applyFighter(attacker, res.a);
  applyFighter(defender, res.b);
  const [winner, loser] = res.winner === "a" ? [attacker, defender] : [defender, attacker];
  loser.protected = true;

  let stolen: number | null = null;
  if (loser.keys.length > 0) {
    const wanted = winner === attacker && stealKey !== undefined && loser.keys.includes(stealKey)
      ? stealKey
      : loser.keys[rng.int(loser.keys.length)]!;
    loser.keys = loser.keys.filter((k) => k !== wanted);
    winner.keys.push(wanted);
    stolen = wanted;
  }
  const how = res.fled ? "drove off" : "beat";
  const took = stolen !== null ? ` and took key ${stolen}` : "";
  log(s, "pvp", `${winner.name} ${how} ${loser.name}${took}.`, attacker.id);
  if (loser.stamina <= 0) defeat(s, loser);
}

function guessChest(s: GameState, p: Player, keys: number[]): string | null {
  if (s.phase !== "roll") return "you can only open the chest instead of rolling";
  if (p.pos !== LAIR) return "you must be in the lair";
  if (!p.wizardBeaten) return "you must beat the wizard first";
  const unique = [...new Set(keys)];
  if (unique.length !== s.config.comboSize) return `choose exactly ${s.config.comboSize} different keys`;
  if (!unique.every((k) => p.keys.includes(k))) return "you can only try keys you hold";

  const correct = unique.filter((k) => s.combination.includes(k)).length;
  const sorted = [...unique].sort((a, b) => a - b);
  if (correct === s.config.comboSize) {
    s.winner = p.id;
    s.phase = "finished";
    log(s, "win", `${p.name} opened the chest with keys ${sorted.join(", ")} and wins!`, p.id);
    return null;
  }
  s.guesses.push({ playerId: p.id, keys: sorted, correct, turn: s.turn });
  p.stamina = Math.max(0, p.stamina - s.config.wrongGuessDamage);
  log(s, "guess", `${p.name} tried keys ${sorted.join(", ")}: ${correct} correct.`, p.id);
  if (p.stamina <= 0) defeat(s, p);
  endTurn(s);
  return null;
}

function pickUpDropped(s: GameState, p: Player) {
  const keys = s.dropped[p.pos];
  if (!keys || keys.length === 0) return;
  p.keys.push(...keys);
  delete s.dropped[p.pos];
  log(s, "pickup", `${p.name} picked up key${keys.length > 1 ? "s" : ""} ${keys.join(", ")}.`, p.id);
}

/** Keys lost in the maze or the lair turn up at the maze entrance, where anyone can reach them. */
function dropKeys(s: GameState, p: Player) {
  if (p.keys.length === 0) return;
  const at = p.pos === LAIR || isMazeTile(p.pos) ? MAZE_SQUARE : p.pos;
  (s.dropped[at] ??= []).push(...p.keys);
  p.keys = [];
}

function defeat(s: GameState, p: Player) {
  const amulet = p.items.indexOf("amulet");
  if (amulet >= 0 && p.keys.length > 0) {
    p.items.splice(amulet, 1);
    log(s, "item", `${p.name}'s Amulet of Return crumbles; they keep their keys.`, p.id);
  } else {
    dropKeys(s, p);
  }
  const wake = p.campReached && BOARD.squares[CAMP] ? CAMP : ENTRANCE;
  p.pos = wake;
  p.stamina = Math.ceil(p.maxStamina / 2);
  p.skipNextTurn = true;
  p.wizardBeaten = false;
  log(s, "defeat", `${p.name} fell and wakes at the ${wake === CAMP ? "camp" : "Entrance"}.`, p.id);
}

function timeout(s: GameState): string | null {
  const p = currentPlayer(s);
  if (s.phase === "orient" && s.pendingFlip) {
    // Auto-turn the flipped tile so the player isn't left on an unplaced tile.
    const { row, col, entrySide } = s.pendingFlip;
    const type = tileAt(s.mazeTiles, row, col);
    p.maze[tileKey(row, col)] = [0, 1, 2, 3].find((r) => openings(type, r) & entrySide)!;
    s.pendingFlip = null;
  }
  p.missedTurns++;
  log(s, "timeout", `${p.name} ran out of time.`, p.id);
  if (p.missedTurns >= s.config.maxMissedTurns) {
    dropKeys(s, p);
    p.status = "removed";
    log(s, "removed", `${p.name} missed ${p.missedTurns} turns and left the game.`, p.id);
  }
  endTurn(s);
  return null;
}

function endTurn(s: GameState) {
  s.pendingRoll = null;
  s.pendingFlip = null;
  s.phase = "roll";
  const active = s.players.filter((x) => x.status === "active");
  if (active.length === 1) {
    s.winner = active[0]!.id;
    s.phase = "finished";
    log(s, "win", `${active[0]!.name} is the last player left and wins.`, active[0]!.id);
    return;
  }
  if (active.length === 0) {
    s.phase = "finished";
    return;
  }
  for (let guard = 0; guard < s.players.length * 2; guard++) {
    s.currentIndex = (s.currentIndex + 1) % s.players.length;
    s.turn++;
    const next = currentPlayer(s);
    if (next.status !== "active") continue;
    next.protected = false;
    if (next.skipNextTurn) {
      next.skipNextTurn = false;
      log(s, "skip", `${next.name} misses this turn.`, next.id);
      continue;
    }
    return;
  }
}

function log(s: GameState, type: string, text: string, playerId?: string, privateTo?: string) {
  const ev: GameState["log"][number] = { turn: s.turn, type, text };
  if (playerId) ev.playerId = playerId;
  if (privateTo) ev.privateTo = privateTo;
  s.log.push(ev);
}
