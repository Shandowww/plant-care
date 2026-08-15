from datetime import UTC, datetime
from pathlib import Path

from fastapi.testclient import TestClient
from plantcare.config import Settings
from plantcare.main import create_app
from plantcare.schemas import HomeAssistantEntity
from plantcare.sync import normalize_reading


class FakeHomeAssistant:
    def __init__(self) -> None:
        observed_at = datetime(2026, 8, 15, 8, 30, tzinfo=UTC)
        self.entities = [
            HomeAssistantEntity(
                entity_id="sensor.fern_moisture",
                name="Fern moisture",
                device_class="moisture",
                state="42",
                unit="%",
                last_updated=observed_at,
            ),
            HomeAssistantEntity(
                entity_id="sensor.fern_temperature",
                name="Fern temperature",
                device_class="temperature",
                state="75.2",
                unit="°F",
                last_updated=observed_at,
            ),
            HomeAssistantEntity(
                entity_id="sensor.fern_battery",
                name="Fern battery",
                device_class="battery",
                state="91",
                unit="%",
                last_updated=observed_at,
            ),
            HomeAssistantEntity(
                entity_id="sensor.fern_illuminance",
                name="Fern illuminance",
                device_class="illuminance",
                state="850",
                unit="lx",
                last_updated=observed_at,
            ),
        ]

    async def list_entities(self) -> list[HomeAssistantEntity]:
        return self.entities


def production_client(tmp_path: Path, source: FakeHomeAssistant) -> TestClient:
    settings = Settings(
        environment="production",
        auth_mode="enabled",
        data_dir=tmp_path,
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'production.db'}",
        static_dir=tmp_path / "static",
        supervisor_token="test-supervisor-token",  # noqa: S106
        sync_interval_seconds=3600,
    )
    return TestClient(
        create_app(settings, home_assistant_client=source),
        headers={
            "x-plantcare-surface": "ingress",
            "x-remote-user-name": "Test User",
        },
    )


def test_mapped_home_assistant_values_are_persisted_and_idempotent(tmp_path: Path) -> None:
    source = FakeHomeAssistant()
    with production_client(tmp_path, source) as client:
        plant = client.post(
            "/api/v1/plants",
            json={
                "display_name": "Office Fern",
                "location": "Office",
                "common_name": "Boston fern",
                "scientific_name": "Nephrolepis exaltata",
                "environment_type": "indoor",
            },
        ).json()
        mapping = {
            "moisture_entity_id": "sensor.fern_moisture",
            "temperature_entity_id": "sensor.fern_temperature",
            "battery_entity_id": "sensor.fern_battery",
            "illuminance_entity_id": "sensor.fern_illuminance",
        }
        mapped = client.patch(f"/api/v1/plants/{plant['id']}/entity-mapping", json=mapping)
        assert mapped.status_code == 200

        synchronized = client.post("/api/v1/home-assistant/sync")
        assert synchronized.status_code == 200
        assert synchronized.json() == {
            "plants_checked": 1,
            "readings_added": 4,
            "invalid_readings": 0,
            "missing_entities": 0,
        }

        refreshed = client.get("/api/v1/plants").json()["plants"][0]
        assert refreshed["state"] == "good"
        assert refreshed["moisture"] == 42
        assert refreshed["temperature"] == 24
        assert refreshed["battery"] == 91
        assert refreshed["illuminance"] == 850
        assert refreshed["last_reading_at"] == "2026-08-15T08:30:00Z"

        history = client.get(
            f"/api/v1/plants/{plant['id']}/readings", params={"metric": "moisture"}
        )
        assert history.status_code == 200
        assert len(history.json()["readings"]) == 1
        assert history.json()["readings"][0]["entity_id"] == "sensor.fern_moisture"

        repeated = client.post("/api/v1/home-assistant/sync")
        assert repeated.status_code == 200
        assert repeated.json()["readings_added"] == 0
        all_history = client.get(f"/api/v1/plants/{plant['id']}/readings").json()
        assert len(all_history["readings"]) == 4


def test_invalid_reading_does_not_replace_last_good_value(tmp_path: Path) -> None:
    source = FakeHomeAssistant()
    with production_client(tmp_path, source) as client:
        plant = client.post(
            "/api/v1/plants",
            json={
                "display_name": "Office Fern",
                "location": "Office",
                "common_name": "Boston fern",
                "environment_type": "indoor",
            },
        ).json()
        client.patch(
            f"/api/v1/plants/{plant['id']}/entity-mapping",
            json={"moisture_entity_id": "sensor.fern_moisture"},
        )
        client.post("/api/v1/home-assistant/sync")
        source.entities[0] = source.entities[0].model_copy(
            update={"state": "unavailable", "last_updated": datetime.now(UTC)}
        )

        result = client.post("/api/v1/home-assistant/sync")

        assert result.status_code == 200
        assert result.json()["invalid_readings"] == 1
        refreshed = client.get("/api/v1/plants").json()["plants"][0]
        assert refreshed["moisture"] == 42
        history = client.get(f"/api/v1/plants/{plant['id']}/readings").json()
        assert len(history["readings"]) == 1


def test_normalization_rejects_out_of_range_percentage() -> None:
    entity = HomeAssistantEntity(
        entity_id="sensor.bad_moisture",
        name="Bad moisture",
        device_class="moisture",
        state="130",
        unit="%",
    )

    assert normalize_reading("moisture", entity) is None
