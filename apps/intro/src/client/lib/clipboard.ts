/**
 * Text onto the clipboard. Without the clipboard API (a page served over
 * plain http, other than localhost) it falls back to copying from a hidden
 * textarea, putting the focus back where it was.
 * @returns whether it was copied
 */
export async function toClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const back = document.activeElement;
    const area = document.createElement("textarea");
    area.value = text;
    area.readOnly = true;
    area.style.cssText = "position: fixed; top: 0; left: 0; opacity: 0";
    document.body.append(area);
    area.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      area.remove();
      if (back instanceof HTMLElement) back.focus();
    }
  }
}
