import { shellViewport } from "../../app/shell-viewport.ts";
import { listen } from "../../lib/reactive/listener.ts";

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
 * Only applies while the shell detects an open keyboard (an editable has focus
 * and the visual viewport is at least 80px shorter), so browser-chrome gaps
 * never reserve space. The inset is the part of the host's visible extent below
 * the visual viewport: a terminal the shell already sizes to `visualViewport`
 * is not shortened twice, and a host scrolled entirely under the keyboard or
 * below the fold gets nothing. Scrolling moves the host without a viewport
 * event, so scroll in any container recomputes it. Pinch zoom changes the
 * height difference without a keyboard, so the shell's native-scale flag gates
 * the keyboard detection.
 */
export function observeTerminalKeyboardReserve(host: HTMLElement): () => void {
  const update = () => {
    const viewport = shellViewport.snapshot;
    let covered = 0;
    if (viewport?.keyboardVisible) {
      const rect = host.getBoundingClientRect();
      const visibleBottom = viewport.offsetTop + viewport.height;
      if (rect.top < visibleBottom) {
        covered = Math.min(rect.bottom, viewport.layoutHeight) - visibleBottom;
      }
    }
    if (covered > 1) {
      host.style.setProperty(TERMINAL_KEYBOARD_RESERVE_PROPERTY, `${Math.round(covered)}px`);
    } else {
      host.style.removeProperty(TERMINAL_KEYBOARD_RESERVE_PROPERTY);
    }
  };
  update();
  const stops = [
    shellViewport.subscribe(update),
    // Scroll does not bubble; capture sees every scroll container.
    listen(window, "scroll", update, { capture: true, passive: true }),
  ];
  return () => {
    stops.forEach((stop) => stop());
    host.style.removeProperty(TERMINAL_KEYBOARD_RESERVE_PROPERTY);
  };
}
