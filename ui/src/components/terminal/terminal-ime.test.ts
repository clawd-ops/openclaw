/* @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installTerminalImeWorkaround } from "./terminal-ime.ts";

let parent: HTMLElement;
let textarea: HTMLTextAreaElement;
let stop: (() => void) | undefined;
let committed: string[];

function setPointer(coarse: boolean, android = true) {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
    android
      ? "Mozilla/5.0 (Linux; Android 15) Chrome/140 Mobile"
      : "Mozilla/5.0 (Windows NT 10.0) Chrome/140",
  );
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
  vi.restoreAllMocks();
});

function nativeCompositionEnd(data: string) {
  textarea.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data }));
}

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

it("writes a commit once when a native compositionend with the same text follows", () => {
  mountGhostty();
  stop = installTerminalImeWorkaround(parent);
  keydown(229);
  beforeInput("insertText", "漢");
  nativeCompositionEnd("漢");
  expect(committed).toEqual(["漢"]);
});

it("writes a commit once when the native compositionend comes first", () => {
  mountGhostty();
  stop = installTerminalImeWorkaround(parent);
  keydown(229);
  nativeCompositionEnd("漢");
  beforeInput("insertText", "漢");
  expect(committed).toEqual(["漢"]);
});

it("writes a genuine repeat after a forwarded commit and a new composition", () => {
  mountGhostty();
  stop = installTerminalImeWorkaround(parent);
  keydown(229);
  beforeInput("insertText", "a");
  textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  nativeCompositionEnd("a");
  expect(committed).toEqual(["a", "a"]);
});

it("writes a genuine repeat after a native-first commit and a new keydown", () => {
  mountGhostty();
  stop = installTerminalImeWorkaround(parent);
  keydown(229);
  nativeCompositionEnd("a");
  keydown(229);
  beforeInput("insertText", "a");
  expect(committed).toEqual(["a", "a"]);
});

it("suppresses a late native compositionend at any delay, without timers", () => {
  vi.useFakeTimers();
  try {
    mountGhostty();
    stop = installTerminalImeWorkaround(parent);
    keydown(229);
    beforeInput("insertText", "a");
    vi.setSystemTime(Date.now() + 3_600_000);
    vi.advanceTimersByTime(3_600_000);
    nativeCompositionEnd("a");
    expect(committed).toEqual(["a"]);
  } finally {
    vi.useRealTimers();
  }
});

it("keeps IME intent through an empty compositionend", () => {
  mountGhostty();
  stop = installTerminalImeWorkaround(parent);
  keydown(229);
  nativeCompositionEnd("");
  beforeInput("insertText", "漢");
  expect(committed).toEqual(["漢"]);
});

it("delivers Backspace after a composition without a new IME keydown", () => {
  mountGhostty();
  stop = installTerminalImeWorkaround(parent);
  keydown(229);
  beforeInput("insertText", "漢");
  nativeCompositionEnd("漢");
  beforeInput("deleteContentBackward");
  expect(committed).toEqual(["漢", "\x7f"]);
});

it("still writes a repeated character typed twice", () => {
  mountGhostty();
  stop = installTerminalImeWorkaround(parent);
  keydown(229);
  beforeInput("insertText", "a");
  keydown(229);
  beforeInput("insertText", "a");
  expect(committed).toEqual(["a", "a"]);
});

it("does nothing on a touch-primary desktop browser", () => {
  setPointer(true, false);
  mountGhostty();
  stop = installTerminalImeWorkaround(parent);
  keydown(229);
  beforeInput("insertText", "漢");
  expect(committed).toEqual([]);
});
