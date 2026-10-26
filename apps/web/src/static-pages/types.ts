export interface StaticPageMeta {
  title: string;
  description: string;
  canonical: string;
  slug: string;
  navLabel?: string;
  jsonLd?: Record<string, unknown> | Array<Record<string, unknown>>;
}

export interface StaticPageDefinition {
  meta: StaticPageMeta;
  renderContent: () => string;
}
