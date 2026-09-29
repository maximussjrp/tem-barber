export type PresetCategory =
  | "corte"
  | "fade"
  | "barba"
  | "combo"
  | "acabamento"
  | "sobrancelha"
  | "infantil"
  | "tratamentos";

export interface PresetCategoryMeta {
  id: PresetCategory;
  label: string;
}

export const PRESET_CATEGORIES: PresetCategoryMeta[] = [
  { id: "corte", label: "Cortes" },
  { id: "fade", label: "Fade" },
  { id: "barba", label: "Barba" },
  { id: "combo", label: "Combos" },
  { id: "acabamento", label: "Acabamento" },
  { id: "sobrancelha", label: "Sobrancelha" },
  { id: "infantil", label: "Infantil" },
  { id: "tratamentos", label: "Tratamentos" },
];

export interface ServiceImagePreset {
  id: string;
  category: PresetCategory;
  label: string;
  imageUrl: string;
}

export const SERVICE_IMAGE_PRESETS: ServiceImagePreset[] = [
  {
    id: "corte-classico",
    category: "corte",
    label: "Corte Clássico",
    imageUrl: "/service-presets/corte/corte-classico.webp",
  },
  {
    id: "corte-tesoura",
    category: "corte",
    label: "Corte na Tesoura",
    imageUrl: "/service-presets/corte/corte-tesoura.webp",
  },
  {
    id: "fade-baixo",
    category: "fade",
    label: "Degradê Baixo",
    imageUrl: "/service-presets/fade/fade-baixo.webp",
  },
  {
    id: "fade-alto",
    category: "fade",
    label: "Degradê Alto",
    imageUrl: "/service-presets/fade/fade-alto.webp",
  },
  {
    id: "fade-taper",
    category: "fade",
    label: "Taper Fade",
    imageUrl: "/service-presets/fade/fade-taper.webp",
  },
  {
    id: "barba-navalhada",
    category: "barba",
    label: "Barba Navalhada",
    imageUrl: "/service-presets/barba/barba-navalhada.webp",
  },
  {
    id: "barba-toalha-quente",
    category: "barba",
    label: "Toalha Quente",
    imageUrl: "/service-presets/barba/barba-toalha-quente.webp",
  },
  {
    id: "combo-cabelo-e-barba",
    category: "combo",
    label: "Combo Cabelo e Barba",
    imageUrl: "/service-presets/combo/combo-cabelo-e-barba.webp",
  },
  {
    id: "acabamento-risco",
    category: "acabamento",
    label: "Risco no Cabelo",
    imageUrl: "/service-presets/acabamento/acabamento-risco.webp",
  },
  {
    id: "acabamento-pezinho",
    category: "acabamento",
    label: "Pezinho e Acabamento",
    imageUrl: "/service-presets/acabamento/acabamento-pezinho.webp",
  },
  {
    id: "sobrancelha-design",
    category: "sobrancelha",
    label: "Design de Sobrancelha",
    imageUrl: "/service-presets/sobrancelha/sobrancelha-design.webp",
  },
  {
    id: "corte-infantil",
    category: "infantil",
    label: "Corte Infantil",
    imageUrl: "/service-presets/infantil/corte-infantil.webp",
  },
  {
    id: "tratamento-barboterapia",
    category: "tratamentos",
    label: "Barboterapia e SPA",
    imageUrl: "/service-presets/tratamentos/tratamento-barboterapia.webp",
  },
];

export function getPresetById(id: string): ServiceImagePreset | undefined {
  return SERVICE_IMAGE_PRESETS.find((preset) => preset.id === id);
}

export function getPresetsByCategory(category?: string): ServiceImagePreset[] {
  if (!category || category === "todos") return SERVICE_IMAGE_PRESETS;
  return SERVICE_IMAGE_PRESETS.filter((preset) => preset.category === category);
}
