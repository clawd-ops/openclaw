import { listen } from "../../lib/reactive/listener.ts";

const IME_KEYDOWN_CODE = 229;
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
 * Ghostty would write a second time. Dedupe follows input transactions, not
 * text or time. A transaction opens at a 229 keydown or `compositionstart` and
 * lasts until the next such boundary or a non-IME keydown. Inside one, a commit
 * forwarded from `beforeinput` suppresses the native `compositionend` that
 * closes it (once, however late it arrives), and a native end that commits
 * first suppresses the `insertText` for it (once). A boundary starts a fresh
 * transaction, so an identical later commit is always written.
 *
 * Ambiguity that remains: a keyboard that reports one commit as keydown 229,
 * `beforeinput`, then `compositionstart` and a native end with the same text, or
 * a native end followed by a new 229 and `beforeinput` for the same commit, is
 * indistinguishable from two genuine commits and is written twice. Intent from a
 * 229 keydown persists through empty `compositionend` events because keyboards
 * do not repeat it for every commit.
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
  // The open input transaction; undefined means no IME intent.
  let transaction: { forwarded?: string; native?: string } | undefined;
  let forwarding = false;

  const onKeyDown = (event: KeyboardEvent) => {
    transaction = event.keyCode === IME_KEYDOWN_CODE || event.isComposing ? {} : undefined;
  };
  const onCompositionStart = () => {
    transaction = {};
  };
  const onCompositionEnd = (event: CompositionEvent) => {
    if (forwarding || !transaction || !event.data) {
      return;
    }
    if (transaction.forwarded?.endsWith(event.data)) {
      // beforeinput already wrote this commit; keep Ghostty from writing it again.
      event.stopImmediatePropagation();
      transaction.forwarded = undefined;
      return;
    }
    transaction.native = event.data;
  };
  const onBeforeInput = (event: InputEvent) => {
    const data = transaction ? committedText(event) : null;
    if (!transaction || !data) {
      return;
    }
    const isText = event.inputType === "insertText";
    if (isText && transaction.native === data) {
      // A native compositionend in this transaction already wrote this commit.
      transaction.native = undefined;
      return;
    }
    if (isText) {
      transaction.forwarded = (transaction.forwarded ?? "") + data;
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
