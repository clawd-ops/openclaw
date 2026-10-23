/* @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installTerminalImeWorkaround } from "./terminal-ime.ts";

let parent: HTMLElement;
let textarea: HTMLTextAreaElement;
let stop: (() => void) | undefined;
let committed: string[];

function setPointer(coarse: boolean) {
  vi.stubGlobal("matchMedia", () => ({ matches: coarse }) as MediaQueryList);
  Object.defineProperty(navigator, "maxTouchPoints", { value: coarse ? 5 : 0, configurable: true });
}

/** Mirrors ghostty-web 0.4.0: cancel beforeinput on the container, write compositionend data. */
function mountGhostty(cancelsBeforeInput = true) {
  parent = document.createElement("div");
  textarea = parent.appendChild(document.createElement("textarea"));
  parent.append(document.createElement("canvas"));
  document.body.append(parent);
  if (cancelsBeforeInput) {
    parent.addEventListener("beforeinput", (event) => event.preventDefault());
  }
  parent.addEventListener("compositionend", (event) => {
    if (event.data) {
      committed.push(event.data);
    }
  });
}

function keydown(keyCode: number) {
  const event = new Event("keydown", { bubbles: true, composed: true });
  Object.defineProperty(event, "keyCode", { value: keyCode });
  textarea.dispatchEvent(event);
}

function beforeInput(inputType: string, data?: string) {
  textarea.dispatchEvent(
    new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType, data }),
  );
}

beforeEach(() => {
  committed = [];
  setPointer(true);
});

afterEach(() => {
  stop?.();
  stop = undefined;
  parent.remove();
  vi.unstubAllGlobals();
});

it("delivers soft-keyboard text after an IME keydown", () => {
  mountGhostty();
  stop = installTerminalImeWorkaround(parent);
  keydown(229);
  beforeInput("insertText", "k");
  keydown(229);
  beforeInput("insertLineBreak");
  keydown(229);
  beforeInput("deleteContentBackward");
  expect(committed).toEqual(["k", "\r", "\x7f"]);
});

it("leaves input alone when the keydown was not from an IME", () => {
  mountGhostty();
  stop = installTerminalImeWorkaround(parent);
  keydown(229);
  keydown(75);
  beforeInput("insertText", "k");
  expect(committed).toEqual([]);
});

it("does nothing on a device without a coarse pointer", () => {
  setPointer(false);
  mountGhostty();
  stop = installTerminalImeWorkaround(parent);
  keydown(229);
  beforeInput("insertText", "k");
  expect(committed).toEqual([]);
});

it("does nothing once ghostty-web stops cancelling beforeinput", () => {
  mountGhostty(false);
  stop = installTerminalImeWorkaround(parent);
  keydown(229);
  beforeInput("insertText", "k");
  expect(committed).toEqual([]);
});

it("stops forwarding after cleanup", () => {
  mountGhostty();
  installTerminalImeWorkaround(parent)();
  keydown(229);
  beforeInput("insertText", "k");
  expect(committed).toEqual([]);
});
