import type { Plant } from "./types";

export interface PlantImage {
  src: string;
  alt: string;
  credit: string;
}

const base = "/images/plants/";

const images: Record<string, PlantImage> = {
  "dracaena trifasciata": {
    src: `${base}snake-plant-card.png`,
    alt: "A complete snake plant in a cream ceramic pot",
    credit: "Species illustration generated for PlantCare",
  },
  "epipremnum aureum": {
    src: `${base}golden-pothos-card.png`,
    alt: "A complete golden pothos in a terracotta pot",
    credit: "Species illustration generated for PlantCare",
  },
  "monstera deliciosa": {
    src: `${base}monstera-card.png`,
    alt: "A complete Monstera deliciosa in a sage ceramic pot",
    credit: "Species illustration generated for PlantCare",
  },
  "olea europaea": {
    src: `${base}olive-tree-card.png`,
    alt: "A complete compact olive tree in a terracotta pot",
    credit: "Species illustration generated for PlantCare",
  },
  spathiphyllum: {
    src: `${base}peace-lily-card.png`,
    alt: "A complete flowering peace lily in a warm-white ceramic pot",
    credit: "Species illustration generated for PlantCare",
  },
};

export function plantImage(plant: Plant): PlantImage | null {
  const scientific = plant.scientific_name?.trim().toLocaleLowerCase("en") ?? "";
  if (images[scientific]) return images[scientific];
  if (scientific.startsWith("spathiphyllum")) return images.spathiphyllum ?? null;
  return null;
}
