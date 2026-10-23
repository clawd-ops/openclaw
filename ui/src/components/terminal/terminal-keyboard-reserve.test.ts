/* @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { connectShellViewport } from "../../app/shell-viewport.ts";
import { observeTerminalKeyboardReserve } from "./terminal-keyboard-reserve.ts";

let viewport: EventTarget & { height: number; offsetTop: number; scale: number };
let frames: FrameRequestCallback[];
let disconnect: (() => void) | undefined;
let stop: (() => void) | undefined;
let host: HTMLElement;
let hostTop: number;
let hostBottom: number;
let editor: HTMLTextAreaElement;

const reserve = () => host.style.getPropertyValue("--tp-keyboard-reserve");

function resize(values: Partial<typeof viewport>) {
  Object.assign(viewport, values);
  viewport.dispatchEvent(new Event("resize"));
  for (const callback of frames.splice(0)) {
    callback(0);
  }
}

beforeEach(() => {
  // Galaxy Z Fold6 in Chrome: the layout viewport stays at 676 with the keyboard open.
  viewport = Object.assign(new EventTarget(), { height: 676, offsetTop: 0, scale: 1 });
  frames = [];
  hostTop = 0;
  hostBottom = 676;
  vi.stubGlobal("visualViewport", viewport);
  vi.stubGlobal("innerHeight", 676);
  vi.stubGlobal("innerWidth", 360);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  host = document.body.appendChild(document.createElement("div"));
  host.getBoundingClientRect = () => ({ top: hostTop, bottom: hostBottom }) as DOMRect;
  disconnect = connectShellViewport();
  editor = document.body.appendChild(document.createElement("textarea"));
  editor.focus();
  stop = observeTerminalKeyboardReserve(host);
});

afterEach(() => {
  stop?.();
  disconnect?.();
  stop = disconnect = undefined;
  host.remove();
  editor.remove();
  vi.unstubAllGlobals();
});

it("reserves the part of the host the keyboard covers, and releases it", () => {
  expect(reserve()).toBe("");
  resize({ height: 363 });
  expect(reserve()).toBe("313px");
  resize({ height: 676 });
  expect(reserve()).toBe("");
});

it("does not shorten a host the shell already sized to the visible viewport", () => {
  hostBottom = 363;
  resize({ height: 363 });
  expect(reserve()).toBe("");
});

it("ignores the viewport difference caused by pinch zoom", () => {
  resize({ height: 338, scale: 2 });
  expect(reserve()).toBe("");
});

it("clears the reserve on cleanup", () => {
  resize({ height: 363 });
  stop?.();
  stop = undefined;
  expect(reserve()).toBe("");
  resize({ height: 300 });
  expect(reserve()).toBe("");
});

it("does not reserve for a host below the fold when no keyboard is open", () => {
  hostTop = 800;
  hostBottom = 1200;
  resize({ height: 676 });
  expect(reserve()).toBe("");
});

it("does not reserve for a host entirely below the visible viewport", () => {
  hostTop = 800;
  hostBottom = 1200;
  resize({ height: 363 });
  expect(reserve()).toBe("");
});

it("does not reserve for a browser-chrome gap without a keyboard", () => {
  resize({ height: 616 });
  expect(reserve()).toBe("");
});

it("drops a stale reserve when scrolling moves the host above the keyboard", () => {
  resize({ height: 363 });
  expect(reserve()).toBe("313px");
  hostBottom = 363;
  window.dispatchEvent(new Event("scroll"));
  expect(reserve()).toBe("");
});
