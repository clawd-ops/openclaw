import { shellViewport } from "../../app/shell-viewport.ts";

const TERMINAL_KEYBOARD_RESERVE_PROPERTY = "--tp-keyboard-reserve";

/**
 * Keeps the terminal grid above the Android soft keyboard.
 *
 * Chrome on Android can leave the layout viewport at full height while the
 * keyboard covers the bottom of the visual viewport, even with
 * `interactive-widget=resizes-content` (measured on a Galaxy Z Fold6:
 * `innerHeight` 676, `visualViewport.height` 363). A docked terminal is
 * positioned against the layout viewport, so its last rows end up under the
 * keyboard. Ghostty's fit reads the host's content box, so padding the host by
 * the covered height is enough to refit it.
 *
 * The inset is the part of the host below the visual viewport, not the raw
 * layout/visual difference: a terminal inside the shell is already sized by
 * `--shell-viewport-height` and must not be shortened twice. Pinch zoom
 * changes that difference without a keyboard, so the shell's native-scale flag
 * gates it.
 */
export function observeTerminalKeyboardReserve(host: HTMLElement): () => void {
  const update = () => {
    const viewport = shellViewport.snapshot;
    const covered = viewport?.nativeScale
      ? host.getBoundingClientRect().bottom - (viewport.offsetTop + viewport.height)
      : 0;
    if (covered > 1) {
      host.style.setProperty(TERMINAL_KEYBOARD_RESERVE_PROPERTY, `${Math.round(covered)}px`);
    } else {
      host.style.removeProperty(TERMINAL_KEYBOARD_RESERVE_PROPERTY);
    }
  };
  update();
  const stop = shellViewport.subscribe(update);
  return () => {
    stop();
    host.style.removeProperty(TERMINAL_KEYBOARD_RESERVE_PROPERTY);
  };
}
