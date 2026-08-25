/**
 * CryoSmart image embedding + HTML report builder integration.
 *
 * Provides helpers to pre-fetch images and pass them to buildLineageHtmlV2
 * so that the generated HTML is fully self-contained (no external requests needed).
 */

import { buildLineageHtmlV2 as _buildLineageHtmlV2 } from "./report-html";

export interface BuildLineageHtmlV2Options {
  /** Pre-fetched images: url → base64 data URL. */
  embeddedImages?: Record<string, string>;
  /**
   * The web app origin for constructing proxy URLs for map downloads.
   * e.g. "http://localhost:3006" or "https://your-server.com"
   * If not provided, map downloads use the raw CryoSmart URL (may fail with CORS).
   */
  webAppOrigin?: string;
}

/**
 * Build a lineage HTML report, optionally with embedded images and a proxy origin
 * for map downloads.
 *
 * When embeddedImages is provided, image src attributes are set to the base64 data URL
 * instead of the local bundle path, making the HTML fully self-contained.
 *
 * When webAppOrigin is provided, map download buttons use the proxy endpoint with
 * session auth instead of opening raw CryoSmart URLs (which fail with CORS).
 */
export function buildLineageHtmlV2(
  summary: Parameters<typeof _buildLineageHtmlV2>[0],
  options?: BuildLineageHtmlV2Options
): string {
  return _buildLineageHtmlV2(summary, options);
}