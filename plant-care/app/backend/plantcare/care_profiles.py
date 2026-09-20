from dataclasses import dataclass


def watering_instructions(scientific_name: str | None, common_name: str) -> str:
    """Technique, not a watering schedule or a replacement for calibrated thresholds.

    References: extension.umd.edu/resource/watering-indoor-plants and
    aos.org/orchid-care/care-sheets/phalaenopsis-culture-sheet.
    """
    identity = (scientific_name or common_name).strip().casefold()
    drainage = (
        "Use a pot with drainage holes. Water slowly across the potting mix until excess "
        "runs out underneath, let it drain fully, and empty the saucer or decorative pot. "
        "Do not keep adding water while waiting for the sensor to respond."
    )
    if "phalaenopsis" in identity or "moth orchid" in identity:
        return (
            "For this moth orchid, water the potting medium with lukewarm water in the "
            "morning, keeping water out of the crown and leaf joints. Let water flow "
            "through the medium and drain completely before returning it to its outer pot. "
            "Do not leave the roots standing in water or use ice cubes."
        )
    if "orchid" in identity:
        return (
            "Orchid species and medium are not confirmed: for a potted orchid in a "
            "free-draining medium, water the medium thoroughly with lukewarm water, "
            "avoid pooling water in leaf joints, and let it drain fully. Empty the outer "
            "pot. Bark and moss dry differently; do not use a fixed watering schedule."
        )
    prefixes = (
        (
            ("dracaena trifasciata", "sansevieria trifasciata", "snake plant"),
            "For this snake plant, direct water onto the mix, not into the leaf rosettes. ",
        ),
        (
            ("zamioculcas zamiifolia", "zz plant"),
            "For this ZZ plant, water the whole root ball in one session "
            "rather than frequent sips. ",
        ),
        (
            ("monstera deliciosa", "monstera"),
            "For this Monstera, spread water around the whole pot, "
            "not just beside the stem or probe. ",
        ),
        (
            ("epipremnum aureum", "golden pothos", "pothos"),
            "For this pothos, wet the mix evenly around the pot rather than watering one spot. ",
        ),
        (
            ("spathiphyllum", "peace lily"),
            "For this peace lily, water the mix evenly in a slow pass, "
            "keeping water off the flowers. ",
        ),
        (
            ("peperomia obtusifolia", "baby rubber plant"),
            "For this peperomia, direct a gentle stream onto the mix rather than the leaf joints. ",
        ),
        (
            ("hoya carnosa",),
            "For this Hoya, water the potting mix evenly rather than misting as a substitute. ",
        ),
        (
            (
                "euphorbia tithymaloides",
                "devil's backbone",
                "euphorbia leuconeura",
                "madagascar jewel",
            ),
            "For this Euphorbia, water the mix around the stem without wetting or damaging it. ",
        ),
        (
            ("olea europaea", "olive tree"),
            "For this potted olive, water across the whole root ball "
            "rather than only at the trunk. ",
        ),
    )
    for aliases, prefix in prefixes:
        if identity in aliases:
            return prefix + drainage
    return "General container-watering technique (species not confirmed): " + drainage


@dataclass(frozen=True)
class CareProfile:
    temperature_minimum: int
    temperature_maximum: int
    moisture_check_threshold: int
    moisture_wet_threshold: int
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
