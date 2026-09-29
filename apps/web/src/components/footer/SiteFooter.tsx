/**
 * Site-wide legal footer (issue #19, overview §4.3): renders the nominative
 * fair-use disclaimer verbatim on the app view. The narrow-viewport
 * roadblock does not render the disclaimer (issue #179).
 */

import React from "react";
import { SITE_DISCLAIMER } from "./disclaimer";

export default function SiteFooter() {
  return (
    <footer className="site-footer" data-testid="site-footer">
      <p className="site-footer-disclaimer">{SITE_DISCLAIMER}</p>
    </footer>
  );
}
