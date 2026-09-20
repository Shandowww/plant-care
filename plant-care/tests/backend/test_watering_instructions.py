import pytest
from plantcare.care_profiles import watering_instructions


@pytest.mark.parametrize(
    ("scientific", "common", "expected"),
    [
        (" Dracaena Trifasciata ", "My plant", "leaf rosettes"),
        (None, "Snake plant", "leaf rosettes"),
        ("Phalaenopsis", "Orchid", "crown"),
        (None, "Orchids", "species and medium are not confirmed"),
        ("Zamioculcas zamiifolia", "ZZ", "one session"),
        (None, "Peace lily", "flowers"),
        ("Unknown species", "Snake plant", "species not confirmed"),
    ],
)
def test_watering_technique_uses_identity_without_guessing(scientific, common, expected):
    instructions = watering_instructions(scientific, common)
    assert expected in instructions
    assert "drain" in instructions
    assert "Check two or three" not in instructions
