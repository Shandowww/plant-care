import type { Plant } from "./types";

export type PlantTip = {
  category: "Water" | "Light" | "Growth" | "Cleaning" | "Safety" | "Seasonal care";
  title: string;
  body: string;
};

export type PlantTipCollection = {
  label: string;
  fallback: boolean;
  tips: PlantTip[];
};

const speciesTips: Record<string, PlantTip[]> = {
  "epipremnum aureum": [
    { category: "Water", title: "Read the soil, not the calendar", body: "Let the upper layer of soil begin to dry before watering, then drain away any excess instead of leaving the pot standing in water." },
    { category: "Light", title: "Variegation follows the light", body: "Bright, indirect light usually supports stronger golden markings. Harsh direct sun can scorch the leaves." },
    { category: "Growth", title: "Trim just above a node", body: "Pruning a long vine just above a leaf node encourages a fuller plant, and healthy cuttings can be rooted separately." },
    { category: "Cleaning", title: "Give broad leaves a gentle wipe", body: "Dust reduces the light reaching each leaf. Use a soft damp cloth and check the undersides for pests while you clean." },
    { category: "Growth", title: "Choose trailing or climbing", body: "Let vines trail for a relaxed shape, or add a pole or trellis if you want larger leaves and upright growth." },
  ],
  "monstera deliciosa": [
    { category: "Light", title: "Aim for bright, filtered light", body: "A position with generous indirect light supports steady growth and mature leaf splits without exposing foliage to intense midday sun." },
    { category: "Growth", title: "Support the climbing side", body: "A moss pole or sturdy stake gives aerial roots somewhere to attach and helps the plant develop a more upright shape." },
    { category: "Water", title: "Check below the surface", body: "Wait until the top layer begins to dry, then water thoroughly and let the container drain. Avoid keeping the mix constantly saturated." },
    { category: "Cleaning", title: "Keep the leaf surface clear", body: "Wipe large leaves with a damp cloth so they can use available light, checking stems and undersides as you go." },
    { category: "Growth", title: "Rotate for balanced growth", body: "Turn the pot a little every week or two so new growth does not lean entirely toward one window." },
  ],
  "olea europaea": [
    { category: "Light", title: "Give an olive your brightest position", body: "Potted olive trees prefer several hours of direct sun. Acclimate gradually when moving one into stronger outdoor light." },
    { category: "Water", title: "Drainage matters more than frequency", body: "Water deeply when the upper soil has dried, then let excess escape freely. Persistent wetness is harder on olives than a short dry spell." },
    { category: "Seasonal care", title: "Expect slower winter growth", body: "Cooler, darker months reduce water use. Recheck the soil rather than continuing a summer watering rhythm." },
    { category: "Growth", title: "Prune lightly for shape", body: "Remove dead or crossing shoots and make modest shaping cuts after the main growth flush instead of heavily pruning all at once." },
    { category: "Growth", title: "Watch a container-bound tree", body: "Roots circling tightly, very rapid drying, or stalled growth can signal that the tree needs fresh mix or a slightly larger pot." },
  ],
  "dracaena trifasciata": [
    { category: "Water", title: "Let the mix dry well", body: "Snake plants store water in their leaves. Wait for the potting mix to dry substantially before watering again." },
    { category: "Water", title: "Keep water out of the crown", body: "Pour onto the soil rather than into the leaf rosette, and empty the saucer so moisture does not remain around the base." },
    { category: "Light", title: "Low light is tolerated, not preferred", body: "The plant survives dim rooms, but brighter indirect light generally produces stronger, steadier growth." },
    { category: "Growth", title: "Do not rush to repot", body: "Snake plants are comfortable slightly root-bound. Move up only one pot size when roots crowd the container or distort it." },
    { category: "Cleaning", title: "Dust the upright leaves", body: "Support each leaf while wiping it with a soft damp cloth, taking care not to crease or snap the tip." },
  ],
  spathiphyllum: [
    { category: "Water", title: "Keep moisture even, not stagnant", body: "Peace lilies prefer lightly moist soil, but the pot should still drain freely. Use the soil and sensor trend together before watering." },
    { category: "Light", title: "Bright shade supports flowers", body: "Filtered light encourages blooming while protecting the leaves from the bleaching and scorch caused by strong direct sun." },
    { category: "Cleaning", title: "Wipe both sides of each leaf", body: "Cleaning improves light capture and creates a regular opportunity to spot scale, mites, or damaged foliage early." },
    { category: "Growth", title: "Remove spent flowers at the base", body: "Once a flower fades, cut its stalk low with clean scissors so the plant can direct energy toward new leaves and blooms." },
    { category: "Safety", title: "Place with pets and children in mind", body: "Peace lily tissue contains irritating calcium oxalate crystals and should not be chewed or eaten." },
  ],
};

const indoorFallback: PlantTip[] = [
  { category: "Water", title: "Confirm before watering", body: "Check the soil and recent sensor trend together. A single reading is useful context, but drainage and the plant's appearance matter too." },
  { category: "Light", title: "Watch how the plant responds", body: "Stretching or leaning can suggest too little light; pale, scorched patches can suggest that direct light is too intense." },
  { category: "Cleaning", title: "Turn inspection into a habit", body: "When wiping leaves, check stems, leaf joints, and undersides for pests or damage before they become widespread." },
  { category: "Growth", title: "Make changes one at a time", body: "After moving, repotting, or changing care, give the plant time to respond before making another major adjustment." },
];

const outdoorFallback: PlantTip[] = [
  { category: "Water", title: "Recheck after weather changes", body: "Wind, heat, and rain can change container moisture quickly, so use the sensor trend and a direct soil check before acting." },
  { category: "Light", title: "Acclimate to stronger sun", body: "Increase direct-sun exposure gradually after moving a plant outdoors to reduce the chance of leaf scorch." },
  { category: "Seasonal care", title: "Protect the roots from extremes", body: "Container roots heat and cool faster than garden soil. Move or insulate the pot during unusually hot or cold weather." },
  { category: "Growth", title: "Check stability and drainage", body: "Keep drainage holes clear and make sure the pot cannot tip in wind, especially as top growth becomes larger." },
];

export function plantTipCollection(plant: Plant): PlantTipCollection {
  const scientificName = plant.scientific_name?.trim().toLowerCase();
  const exact = scientificName ? speciesTips[scientificName] : undefined;
  if (exact) return { label: `Care guide for ${plant.common_name}`, fallback: false, tips: exact };

  const matched = scientificName
    ? Object.entries(speciesTips).find(([name]) => scientificName.startsWith(`${name} `))
    : undefined;
  if (matched) return { label: `Care guide for ${plant.common_name}`, fallback: false, tips: matched[1] };

  const outdoor = plant.environment_type !== "indoor";
  return {
    label: outdoor ? "General outdoor container guide" : "General indoor plant guide",
    fallback: true,
    tips: outdoor ? outdoorFallback : indoorFallback,
  };
}
