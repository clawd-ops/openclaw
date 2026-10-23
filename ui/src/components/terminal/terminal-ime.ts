import { listen } from "../../lib/reactive/listener.ts";

const IME_KEYDOWN_CODE = 229;
// A commit can arrive both as beforeinput and as a native compositionend. The
// counterpart follows within the same input turn; a later repeat is new typing.
const NATIVE_COUNTERPART_MS = 100;
const SYNTHETIC_COUNTERPART_MS = 1000;

/** Bytes a soft keyboard commits through beforeinput instead of keydown. */
function committedText(event: InputEvent): string | null {
  switch (event.inputType) {
    case "insertText":
      return event.data ?? "";
    case "insertLineBreak":
    case "insertParagraph":
      return "\r";
    case "deleteContentBackward":
      return "\x7f";
    default:
      return null;
  }
}

/**
 * Forwards Android soft-keyboard text that ghostty-web 0.4.0 drops.
 *
 * Ghostty cancels every `beforeinput` on its container and ignores keydowns
 * with keyCode 229, which is how Android keyboards announce committed text, so
 * the text never reaches the PTY (coder/ghostty-web#120). Hand it to Ghostty's
 * own `compositionend` handler, which already writes `event.data` to the PTY.
 *
 * Some keyboards also finish with a native data-bearing `compositionend`, which
 * Ghostty would write a second time. Each committed string is therefore written
 * once: whichever path arrives second is dropped. Intent from a 229 keydown
 * persists until an unrelated key, because keyboards do not repeat it for every
 * commit and may end a composition with empty data.
 *
 * Limited to Android with a coarse pointer, the platform where the defect was
 * observed; desktop IMEs, including touch-primary desktops, end compositions
 * natively. Remove once #120 is fixed in the ghostty-web version this UI uses.
 */
export function installTerminalImeWorkaround(parent: HTMLElement): () => void {
  if (
    !/Android/u.test(navigator.userAgent) ||
    !(navigator.maxTouchPoints > 0) ||
    typeof window.matchMedia !== "function" ||
    !window.matchMedia("(pointer: coarse)").matches
  ) {
    return () => {};
  }
  // Ghostty opens into `parent`, so its beforeinput guard and compositionend
  // listener both live there. Probe before listening so a fixed ghostty-web
  // (one that no longer cancels beforeinput) never gets duplicate input.
  const probe = new InputEvent("beforeinput", { cancelable: true, inputType: "insertText" });
  parent.dispatchEvent(probe);
  if (!probe.defaultPrevented) {
    return () => {};
  }
  let imeIntent = false;
  let forwarding = false;
  // Text one path wrote that the other path may still announce.
  let written: { by: "native" | "forwarded"; text: string; at: number } | undefined;
  const counterpartOf = (by: "native" | "forwarded", at: number) =>
    written && written.by !== by
      ? at - written.at <= (by === "native" ? SYNTHETIC_COUNTERPART_MS : NATIVE_COUNTERPART_MS)
        ? written
        : undefined
      : undefined;

  const onKeyDown = (event: KeyboardEvent) => {
    imeIntent = event.keyCode === IME_KEYDOWN_CODE || event.isComposing;
  };
  const onCompositionStart = () => {
    imeIntent = true;
  };
  const onCompositionEnd = (event: CompositionEvent) => {
    if (forwarding || !event.data) {
      return;
    }
    const pending = counterpartOf("native", event.timeStamp);
    if (pending && pending.text.endsWith(event.data)) {
      // Already written from beforeinput; keep Ghostty from writing it again.
      event.stopImmediatePropagation();
      written = undefined;
      return;
    }
    written = { by: "native", text: event.data, at: event.timeStamp };
  };
  const onBeforeInput = (event: InputEvent) => {
    const data = imeIntent ? committedText(event) : null;
    if (!data) {
      return;
    }
    const isText = event.inputType === "insertText";
    const pending = isText ? counterpartOf("forwarded", event.timeStamp) : undefined;
    if (pending?.text === data) {
      // A native compositionend already wrote this commit.
      written = undefined;
      return;
    }
    if (isText) {
      const previous = written?.by === "forwarded" ? written : undefined;
      written = {
        by: "forwarded",
        text:
          previous && event.timeStamp - previous.at <= SYNTHETIC_COUNTERPART_MS
            ? previous.text + data
            : data,
        at: event.timeStamp,
      };
    }
    forwarding = true;
    try {
      parent.dispatchEvent(new CompositionEvent("compositionend", { data }));
    } finally {
      forwarding = false;
    }
  };
  // Capture runs ahead of the bubble-phase listeners that cancel or consume the event.
  const stops = [
    listen(parent, "keydown", onKeyDown, true),
    listen(parent, "compositionstart", onCompositionStart, true),
    listen(parent, "compositionend", onCompositionEnd, true),
    listen(parent, "beforeinput", onBeforeInput, true),
  ];
  return () => stops.forEach((stop) => stop());
}
