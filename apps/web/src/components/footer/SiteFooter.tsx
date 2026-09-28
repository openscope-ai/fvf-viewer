/**
 * Site-wide legal footer (issue #19, overview §4.3): renders the nominative
 * fair-use disclaimer verbatim on every app view, including the narrow
 * viewport roadblock (compact variant).
 */

import React from "react";
import { SITE_DISCLAIMER } from "./disclaimer";

export interface SiteFooterProps {
  /** Compact rendering for the roadblock overlay. */
  compact?: boolean;
}

export default function SiteFooter({ compact = false }: SiteFooterProps) {
  return (
    <footer
      className={`site-footer ${compact ? "site-footer--compact" : ""}`.trim()}
      data-testid="site-footer"
    >
      <p className="site-footer-disclaimer">{SITE_DISCLAIMER}</p>
    </footer>
  );
}
