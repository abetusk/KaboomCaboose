// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// The lobby (D7.6): a panel shown before joining a room. It lists the
// open rooms (the page asks the server every few seconds while it is
// shown), joins one from the list or by code, and makes a new room with
// its options: name, listed or by code only, number of levels, level
// width and length, and difficulty. The player's name and character
// (2026-11-20) are kept in the browser for next time. AR players get the
// walk-in lobby instead (server/lobby.ts), with the same character kept.
//

import { ROOM_LIMITS, CHARACTERS, type RoomsMsg, type RoomInfo } from "../net/protocol.ts";

export interface CreateOptions {
  room       : string;
  open       : boolean;
  levels     : number;
  width      : number;
  length     : number;
  difficulty : string;
}

const NAME_KEY = "voxel-rail.name",
      CHAR_KEY = "voxel-rail.character";

function stored(key: string): string {
  try { return ( localStorage.getItem(key) ?? "" ); } catch { return ""; }
}

function store(key: string, v: string): void {
  try { localStorage.setItem(key, v); } catch { }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = "", cls = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text) { e.textContent = text; }
  if (cls)  { e.className = cls; }
  return e;
}

function numberInput(lim: readonly [number, number], v: number): HTMLInputElement {
  const i = el("input");
  i.type  = "number";
  i.min   = String(lim[0]);
  i.max   = String(lim[1]);
  i.step  = "1";
  i.value = String(v);
  return i;
}

export class Lobby {
  root    : HTMLDivElement;
  name    : HTMLInputElement;
  list    : HTMLTableSectionElement;
  code    : HTMLInputElement;
  msg     : HTMLDivElement;
  picks   : HTMLButtonElement[];
  private chosen = "";
  form    : { room: HTMLInputElement, open: HTMLInputElement, levels: HTMLInputElement, width: HTMLInputElement,
              length: HTMLInputElement, difficulty: HTMLSelectElement };
  private filled = false;

  // join: a room code; create: the new room's options.
  //
  constructor(defaultName: string, join: (code: string) => void, create: (o: CreateOptions) => void) {
    this.root = el("div");
    this.root.id = "lobby";

    // Keys typed here are for the fields, not the game.
    //
    this.root.addEventListener("keydown", e => e.stopPropagation());

    this.root.append(el("h1", "voxel-rail"));
    this.name = el("input");
    this.name.maxLength = 24;
    this.name.value = ( stored(NAME_KEY) || defaultName );
    this.name.addEventListener("change", () => store(NAME_KEY, this.playerName));
    const nameRow = el("label", "Your name ");
    nameRow.append(this.name);
    this.root.append(nameRow);

    // Character: one button each, the one picked lit; none picked, the
    // server deals one out.
    //
    const charRow = el("div", "", "row chars");
    charRow.append(el("span", "Character"));
    this.picks = CHARACTERS.map(ch => {
      const b = el("button", ch[0].toUpperCase() + ch.slice(1));
      b.addEventListener("click", () => this.pick(ch));
      charRow.append(b);
      return b;
    });
    this.root.append(charRow);
    this.pick(stored(CHAR_KEY), false);

    // Open rooms.
    //
    this.root.append(el("h2", "Open rooms"));
    const table = el("table"), head = el("thead"), hr = el("tr");
    for (const h of ["Room", "Players", "Level", "Size", "Difficulty", ""]) { hr.append(el("th", h)); }
    head.append(hr);
    this.list = el("tbody");
    table.append(head, this.list);
    this.root.append(table);

    // By code.
    //
    this.root.append(el("h2", "Join by code"));
    const codeRow = el("div", "", "row");
    this.code = el("input");
    this.code.maxLength = 4;
    this.code.placeholder = "ABCD";
    this.code.className = "code";
    const joinBtn = el("button", "Join");
    joinBtn.addEventListener("click", () => { if (this.code.value.trim()) { join(this.code.value.trim().toUpperCase()); } });
    this.code.addEventListener("keydown", e => { if (e.key === "Enter") { joinBtn.click(); } });
    codeRow.append(this.code, joinBtn);
    this.root.append(codeRow);

    // New room.
    //
    this.root.append(el("h2", "New room"));
    const grid = el("div", "", "form");
    this.form = {
      room       : el("input"),
      open       : el("input"),
      levels     : numberInput(ROOM_LIMITS.levels, 12),
      width      : numberInput(ROOM_LIMITS.width, 10),
      length     : numberInput(ROOM_LIMITS.length, 70),
      difficulty : el("select"),
    };
    this.form.room.maxLength = 32;
    this.form.room.placeholder = "any name";
    this.form.open.type = "checkbox";
    this.form.open.checked = true;
    const rows: [string, HTMLElement, string][] = [
      ["Room name", this.form.room, ""],
      ["Listed", this.form.open, "anyone can see and join it; otherwise only with the code"],
      ["Levels", this.form.levels, ROOM_LIMITS.levels.join(" to ") + "; levels x width x length at most " + ROOM_LIMITS.cells],
      ["Width", this.form.width, ROOM_LIMITS.width.join(" to ") + " cells across"],
      ["Length", this.form.length, ROOM_LIMITS.length.join(" to ") + " cells, station to station"],
      ["Difficulty", this.form.difficulty, ""],
    ];
    for (const [label, input, hint] of rows) {
      const l = el("label", label);
      l.title = hint;
      grid.append(l, input);
    }
    // The test run (difficulty "test") is meant short: picking it sets 4
    // levels, which can still be changed; its levels have a length of
    // their own (10 cells of track between stations), so the length field
    // is off for it.
    //
    this.form.difficulty.addEventListener("change", () => {
      const test = (this.form.difficulty.value === "test");
      this.form.length.disabled = test;
      this.form.length.title    = ( test ? "test levels are short: 10 cells of track between stations" : "" );
      if (test) { this.form.levels.value = "4"; this.form.width.value = "10"; }
    });
    const createBtn = el("button", "Create and join");
    createBtn.addEventListener("click", () => {
      const f = this.form, n = (i: HTMLInputElement) => Number(i.value);
      create({ room: f.room.value.trim(), open: f.open.checked, levels: n(f.levels), width: n(f.width), length: n(f.length),
               difficulty: f.difficulty.value });
    });
    this.root.append(grid, createBtn);

    this.msg = el("div", "", "msg");
    this.root.append(this.msg);
    document.body.append(this.root);
  }

  // The character picked ("" none), kept in the browser.
  //
  get character(): string { return this.chosen; }

  pick(ch: string, keep = true): void {
    if (!CHARACTERS.includes(ch)) { return; }
    this.chosen = ch;
    if (keep) { store(CHAR_KEY, ch); }
    this.picks.forEach((b, k) => b.classList.toggle("on", (CHARACTERS[k] === ch)));
  }

  get playerName(): string { return ( this.name.value.trim().slice(0, 24) || "player" ); }

  get shown(): boolean { return (this.root.style.display !== "none"); }

  show(): void { this.root.style.display = ""; }

  hide(): void { this.root.style.display = "none"; this.msg.textContent = ""; }

  error(text: string): void { this.msg.textContent = text; }

  // The server's list. The form's starting values and the difficulty
  // choices are filled from the first list.
  //
  rooms(m: RoomsMsg, join: (code: string) => void): void {
    if (!this.filled) {
      this.filled = true;
      const f = this.form;
      f.levels.value = String(m.defaults.levels);
      f.width.value  = String(m.defaults.width);
      f.length.value = String(m.defaults.length);
      for (const d of m.difficulties) {
        const o = el("option", d);
        o.value = d;
        f.difficulty.append(o);
      }
      f.difficulty.value = m.defaults.difficulty;
    }
    this.list.replaceChildren(...m.rooms.map((r: RoomInfo) => {
      const tr = el("tr"), b = el("button", "Join");
      b.addEventListener("click", () => join(r.code));
      tr.append(el("td", r.name + " (" + r.code + ")"), el("td", String(r.players)), el("td", r.level + " of " + r.levels),
                el("td", r.width + " x " + r.length), el("td", r.difficulty));
      const td = el("td");
      td.append(b);
      tr.append(td);
      return tr;
    }));
    if (!m.rooms.length) {
      const tr = el("tr"), td = el("td", "none yet: make one below");
      td.colSpan = 6;
      tr.append(td);
      this.list.append(tr);
    }
  }
}
