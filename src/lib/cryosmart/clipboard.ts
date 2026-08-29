/**
 * Clipboard helper with a fallback for non-secure contexts.
 *
 * `navigator.clipboard` is only defined in secure contexts (https,
 * http://localhost, http://127.0.0.1). This app is typically deployed on a
 * LAN over plain HTTP (e.g. http://192.168.x.x:3000), where
 * `navigator.clipboard` is `undefined` and `navigator.clipboard.writeText`
 * throws a TypeError. Fall back to a hidden textarea + execCommand, which
 * still works in every desktop browser even without a secure context.
 *
 * Returns true on success. Shared by the Smart Capture script copy, the
 * Share dialog and the Mermaid copy button (each previously implemented a
 * different subset of this logic — the Mermaid one had NO fallback and NO
 * try/catch, so it silently failed on the primary LAN-HTTP deployment).
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the execCommand fallback below
    }
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
