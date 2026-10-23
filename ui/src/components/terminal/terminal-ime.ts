import { listen } from "../../lib/reactive/listener.ts";

const IME_KEYDOWN_CODE = 229;

/** Bytes a coarse-pointer keyboard commits through beforeinput instead of keydown. */
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
 * Desktop IMEs still end compositions natively, so this is limited to coarse
 * pointers to avoid sending that input twice.
 *
 * Remove once #120 is fixed in the ghostty-web version this UI depends on.
 */
export function installTerminalImeWorkaround(parent: HTMLElement): () => void {
  if (
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
  let imeKeydown = false;
  const onKeyDown = (event: KeyboardEvent) => {
    imeKeydown = event.keyCode === IME_KEYDOWN_CODE || event.isComposing;
  };
  const onCompositionEnd = () => {
    imeKeydown = false;
  };
  const onBeforeInput = (event: InputEvent) => {
    const data = imeKeydown ? committedText(event) : null;
    if (data) {
      parent.dispatchEvent(new CompositionEvent("compositionend", { data }));
    }
  };
  // Capture runs ahead of the bubble-phase listener that cancels the event.
  const stops = [
    listen(parent, "keydown", onKeyDown, true),
    listen(parent, "compositionend", onCompositionEnd, true),
    listen(parent, "beforeinput", onBeforeInput, true),
  ];
  return () => stops.forEach((stop) => stop());
}
