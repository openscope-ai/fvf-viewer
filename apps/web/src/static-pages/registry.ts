import { faqPage } from "./pages/faq";
import { fvfFileFormatPage } from "./pages/fvf-file-format";
import { openFvfFilePage } from "./pages/open-fvf-file";
import { supportedScopemeterModelsPage } from "./pages/supported-scopemeter-models";
import type { StaticPageDefinition } from "./types";

export const staticPages: StaticPageDefinition[] = [
  openFvfFilePage,
  supportedScopemeterModelsPage,
  fvfFileFormatPage,
  faqPage,
];

export function getStaticPage(slug: string): StaticPageDefinition | undefined {
  return staticPages.find((page) => page.meta.slug === slug);
}
