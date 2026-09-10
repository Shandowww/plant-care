from dataclasses import dataclass


@dataclass(frozen=True)
class CareProfile:
    temperature_minimum: int
    temperature_maximum: int
    moisture_minimum: int
    moisture_maximum: int
    basis: str


SPECIES_PROFILES: dict[str, CareProfile] = {
    "epipremnum aureum": CareProfile(18, 29, 25, 60, "golden pothos profile"),
    "monstera deliciosa": CareProfile(16, 29, 30, 65, "Monstera deliciosa profile"),
    "olea europaea": CareProfile(10, 30, 15, 45, "potted olive profile"),
    "dracaena trifasciata": CareProfile(16, 29, 10, 45, "snake plant profile"),
    "spathiphyllum": CareProfile(20, 29, 35, 70, "peace lily profile"),
    "euphorbia tithymaloides": CareProfile(16, 29, 15, 45, "devil's backbone profile"),
    "euphorbia leuconeura": CareProfile(15, 30, 20, 50, "Madagascar jewel profile"),
}


def care_profile(
    scientific_name: str | None,
    common_name: str,
    environment_type: str,
) -> CareProfile:
    normalized_scientific_name = (scientific_name or "").strip().lower()
    exact = SPECIES_PROFILES.get(normalized_scientific_name)
    if exact is not None:
        return exact

    normalized_common_name = common_name.strip().lower()
    if "orchid" in normalized_common_name or "phalaenopsis" in normalized_scientific_name:
        return CareProfile(
            16,
            29,
            20,
            55,
            "broad warm-growing orchid fallback; exact species and potting medium are needed",
        )

    if environment_type == "indoor":
        return CareProfile(18, 29, 20, 60, "general indoor fallback; species not confirmed")
    return CareProfile(5, 35, 15, 65, "general outdoor-container fallback; species not confirmed")
