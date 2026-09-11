from datetime import UTC, datetime, timedelta
from pathlib import Path

import plantcare.home_assistant as home_assistant_module
import pytest
from fastapi.testclient import TestClient
from plantcare.config import Settings
from plantcare.database import Database
from plantcare.home_assistant import HomeAssistantClient
from plantcare.main import create_app
from plantcare.schemas import HomeAssistantEntity
from plantcare.sync import normalize_reading
from sqlalchemy import text


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


class FakeHomeAssistantNotifier:
    def __init__(self) -> None:
        self.created: list[dict[str, str]] = []
        self.dismissed: list[str] = []

    async def ingress_url(self) -> str:
        return "/api/hassio_ingress/test-session/"

    async def create_persistent_notification(
        self, *, notification_id: str, title: str, message: str
    ) -> None:
        self.created.append(
            {"notification_id": notification_id, "title": title, "message": message}
        )

    async def dismiss_persistent_notification(self, *, notification_id: str) -> None:
        self.dismissed.append(notification_id)


def production_client(
    tmp_path: Path,
    source: FakeHomeAssistant,
    notifier: FakeHomeAssistantNotifier | None = None,
) -> TestClient:
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
        create_app(
            settings,
            home_assistant_client=source,
            home_assistant_notifier=notifier,
        ),
        headers={
            "x-plantcare-surface": "ingress",
            "x-remote-user-name": "Test User",
        },
    )


@pytest.mark.asyncio
async def test_database_configures_wal_once_and_connection_safety_pragmas(tmp_path: Path) -> None:
    settings = Settings(
        environment="test",
        data_dir=tmp_path,
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'pragmas.db'}",
    )
    database = Database(settings)
    await database.initialize()

    async with database.engine.connect() as connection:
        journal_mode = await connection.scalar(text("PRAGMA journal_mode"))
        foreign_keys = await connection.scalar(text("PRAGMA foreign_keys"))
        busy_timeout = await connection.scalar(text("PRAGMA busy_timeout"))

    await database.close()
    assert journal_mode == "wal"
    assert foreign_keys == 1
    assert busy_timeout == 10_000


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
            "readings_added": 0,
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


def test_plant_created_with_mapping_is_hydrated_immediately(tmp_path: Path) -> None:
    source = FakeHomeAssistant()
    with production_client(tmp_path, source) as client:
        created = client.post(
            "/api/v1/plants",
            json={
                "display_name": "Office Fern",
                "location": "Office",
                "common_name": "Boston fern",
                "scientific_name": "Nephrolepis exaltata",
                "environment_type": "indoor",
                "entity_mapping": {
                    "moisture_entity_id": "sensor.fern_moisture",
                    "temperature_entity_id": "sensor.fern_temperature",
                    "battery_entity_id": "sensor.fern_battery",
                    "illuminance_entity_id": "sensor.fern_illuminance",
                },
            },
        )

        assert created.status_code == 201
        assert created.json()["state"] == "good"
        assert created.json()["moisture"] == 42
        assert created.json()["temperature"] == 24
        assert created.json()["battery"] == 91
        assert created.json()["illuminance"] == 850
        assert created.json()["last_reading_at"] == "2026-08-15T08:30:00Z"


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


def test_home_assistant_entity_includes_area_and_device_metadata() -> None:
    entity = HomeAssistantClient._parse_entity(
        {
            "entity_id": "sensor.office_fern_moisture",
            "state": "42",
            "attributes": {
                "friendly_name": "Office Fern Soil moisture",
                "device_class": "moisture",
                "unit_of_measurement": "%",
            },
            "last_changed": "2026-08-15T08:25:00Z",
            "last_updated": "2026-08-15T08:30:00Z",
        },
        ("Office", "device-fern"),
    )

    assert entity is not None
    assert entity.area_name == "Office"
    assert entity.device_id == "device-fern"
    assert entity.last_changed == datetime(2026, 8, 15, 8, 25, tzinfo=UTC)


def test_unchanged_sensor_creates_notification_and_recovers(tmp_path: Path) -> None:
    source = FakeHomeAssistant()
    notifier = FakeHomeAssistantNotifier()
    now = datetime.now(UTC)
    source.entities[0] = source.entities[0].model_copy(
        update={
            "last_changed": now - timedelta(hours=73),
            "last_updated": now,
        }
    )
    source.entities[2] = source.entities[2].model_copy(
        update={
            "last_changed": now - timedelta(days=10),
            "last_updated": now,
        }
    )

    with production_client(tmp_path, source, notifier) as client:
        plant = client.post(
            "/api/v1/plants",
            json={
                "display_name": "Office Fern",
                "location": "Office",
                "common_name": "Boston fern",
                "scientific_name": "Nephrolepis exaltata",
                "environment_type": "indoor",
                "entity_mapping": {
                    "moisture_entity_id": "sensor.fern_moisture",
                    "battery_entity_id": "sensor.fern_battery",
                },
            },
        ).json()

        synchronized = client.post("/api/v1/home-assistant/sync")

        assert synchronized.status_code == 200
        refreshed = client.get("/api/v1/plants").json()["plants"][0]
        assert refreshed["state"] == "sensor_issue"
        actions = client.get("/api/v1/actions").json()["actions"]
        assert len(actions) == 1
        assert actions[0]["type"] == "sensor_issue"
        assert actions[0]["title"] == "Check moisture sensor"
        assert "73 hours" in actions[0]["observation"]
        assert len(notifier.created) == 1
        assert "PlantCare: Office Fern sensor warning" == notifier.created[0]["title"]
        assert (
            f"/api/hassio_ingress/test-session/#plants/{plant['id']}"
            in notifier.created[0]["message"]
        )
        assert "battery" not in actions[0]["title"].lower()

        repeated = client.post("/api/v1/home-assistant/sync")
        assert repeated.status_code == 200
        assert len(notifier.created) == 1

        source.entities[0] = source.entities[0].model_copy(
            update={"state": "43", "last_changed": now, "last_updated": now}
        )
        recovered = client.post("/api/v1/home-assistant/sync")

        assert recovered.status_code == 200
        completed = client.get("/api/v1/actions").json()["actions"][0]
        assert completed["status"] == "completed"
        assert completed["completed_by"] == "Automatic sensor recovery"
        assert notifier.dismissed == [notifier.created[0]["notification_id"]]


async def test_home_assistant_metadata_includes_all_areas() -> None:
    class TemplateResponse:
        text = """{
          "entities": [{
            "entity_id": "sensor.office_fern_moisture",
            "area_name": "Office",
            "device_id": "device-fern"
          }],
          "areas": ["Kitchen", "Office", "Kitchen"]
        }"""

        def raise_for_status(self) -> None:
            return None

    class TemplateClient:
        async def post(self, *_args: object, **_kwargs: object) -> TemplateResponse:
            return TemplateResponse()

    client = HomeAssistantClient("token")
    metadata = await client._entity_metadata(TemplateClient())  # type: ignore[arg-type]

    assert metadata == {"sensor.office_fern_moisture": ("Office", "device-fern")}
    assert client.areas == ["Kitchen", "Office"]


async def test_home_assistant_notification_services_and_ingress_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests: list[tuple[str, str, dict[str, object] | None]] = []

    class FakeResponse:
        def __init__(self, payload: dict[str, object] | None = None) -> None:
            self.payload = payload or {}

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, object]:
            return self.payload

    class FakeAsyncClient:
        def __init__(self, *, base_url: str, **_kwargs: object) -> None:
            self.base_url = base_url

        async def __aenter__(self) -> "FakeAsyncClient":
            return self

        async def __aexit__(self, *_args: object) -> None:
            return None

        async def get(self, path: str) -> FakeResponse:
            requests.append((self.base_url, path, None))
            return FakeResponse({"data": {"ingress_url": "/api/hassio_ingress/session"}})

        async def post(self, path: str, *, json: dict[str, object]) -> FakeResponse:
            requests.append((self.base_url, path, json))
            return FakeResponse()

    monkeypatch.setattr(home_assistant_module.httpx2, "AsyncClient", FakeAsyncClient)
    client = HomeAssistantClient("supervisor-token")

    assert await client.ingress_url() == "/api/hassio_ingress/session/"
    await client.create_persistent_notification(
        notification_id="plantcare_sensor",
        title="Sensor warning",
        message="Open PlantCare",
    )
    await client.dismiss_persistent_notification(notification_id="plantcare_sensor")

    assert requests == [
        ("http://supervisor/", "addons/self/info", None),
        (
            "http://supervisor/core/api/",
            "services/persistent_notification/create",
            {
                "notification_id": "plantcare_sensor",
                "title": "Sensor warning",
                "message": "Open PlantCare",
            },
        ),
        (
            "http://supervisor/core/api/",
            "services/persistent_notification/dismiss",
            {"notification_id": "plantcare_sensor"},
        ),
    ]
