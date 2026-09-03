/**
 * Plain-noun Arabic labels for the free-text unit codes stored on
 * workTypeDefs.defaultUnit / jobItems.unit / compensationRules.unit
 * ("meter" | "unit" | "job" | "day"). For the INTERNAL (Arabic-only) app
 * UI only — see AGENTS.md. The customer-facing quote surfaces (public
 * signing page, quote PDF) are bilingual and use `unitLabel` on
 * src/lib/quote-i18n.ts's QuoteLabels instead.
 *
 * Also distinct from settings/compensation-rules-section.tsx's own
 * UNIT_LABEL_AR, which uses the preposition form ("بالمتر") for that
 * page's own "priced by" column — kept as its own map there.
 *
 * A unit not in the map (including a value already written out in
 * Arabic) is returned unchanged, so any existing or freely-typed unit
 * text still displays correctly.
 */
const UNIT_LABEL_AR: Record<string, string> = {
  meter: "متر",
  unit: "قطعة",
  job: "مهمة",
  day: "يوم",
};

export function unitLabelAr(unit: string | null | undefined): string {
  if (!unit) return "";
  return UNIT_LABEL_AR[unit] ?? unit;
}
