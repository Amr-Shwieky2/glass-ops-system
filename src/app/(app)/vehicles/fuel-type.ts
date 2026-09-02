/**
 * Shared Arabic labels for vehicleFuelTypeEnum (5 real values — see the
 * schema, not the 3 the phase brief guessed). Used by every vehicles/
 * page and dialog so the list, detail, and forms never drift apart.
 */
export const FUEL_TYPE_LABEL_AR: Record<
  "petrol" | "diesel" | "electric" | "hybrid" | "other",
  string
> = {
  petrol: "بنزين",
  diesel: "ديزل",
  electric: "كهرباء",
  hybrid: "هجين",
  other: "أخرى",
};

export const FUEL_TYPE_OPTIONS: { value: keyof typeof FUEL_TYPE_LABEL_AR; label: string }[] = [
  { value: "petrol", label: FUEL_TYPE_LABEL_AR.petrol },
  { value: "diesel", label: FUEL_TYPE_LABEL_AR.diesel },
  { value: "electric", label: FUEL_TYPE_LABEL_AR.electric },
  { value: "hybrid", label: FUEL_TYPE_LABEL_AR.hybrid },
  { value: "other", label: FUEL_TYPE_LABEL_AR.other },
];
