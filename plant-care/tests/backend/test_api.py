from io import BytesIO
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from plantcare.config import Settings
from plantcare.main import create_app
from plantcare.plant_doctor import PlantDoctorContext, PlantDoctorProviderError
from plantcare.schemas import PlantDoctorResponse


class StubPlantDoctor:
    def __init__(self) -> None:
        self.calls: list[tuple[bytes, PlantDoctorContext]] = []

    async def analyze(self, photo: bytes, context: PlantDoctorContext) -> PlantDoctorResponse:
        self.calls.append((photo, context))
        return PlantDoctorResponse(
            summary="The plant looks generally healthy.",
            observations=["Leaves are mostly green."],
            possible_issues=["One leaf may have a dry edge."],
            next_steps=["Inspect the underside of the leaves."],
            confidence="medium",
            provider="Cloudflare Workers AI",
            model="@cf/meta/llama-3.2-11b-vision-instruct",
            neurons=12.5,
            disclaimer="Confirm the guidance before changing care.",
        )


class FailingPlantDoctor:
    def __init__(self, kind: str) -> None:
        self.kind = kind

    async def analyze(self, photo: bytes, context: PlantDoctorContext) -> PlantDoctorResponse:
        del photo, context
        raise PlantDoctorProviderError(self.kind)  # type: ignore[arg-type]


def diagnostic_photo(*, size: tuple[int, int] = (64, 64), color: str = "green") -> bytes:
    source = BytesIO()
    Image.new("RGB", size, color).save(source, format="JPEG")
    return source.getvalue()


def request_diagnosis(
    client: TestClient,
    plant_id: str,
    photo: bytes,
    *,
    consent: bool = True,
):
    return client.post(
        f"/api/v1/plants/{plant_id}/doctor",
        data={"consent": str(consent).lower()},
        files={"photo": ("diagnostic.jpg", photo, "image/jpeg")},
    )


@pytest.fixture
def development_client(tmp_path: Path) -> TestClient:
    settings = Settings(
        environment="test",
        auth_mode="disabled",
        data_dir=tmp_path,
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'test.db'}",
        static_dir=tmp_path / "static",
    )
    with TestClient(create_app(settings)) as client:
        yield client


def test_health_reports_simulator(development_client: TestClient) -> None:
    response = development_client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ready",
        "version": "0.7.0",
        "database": "ready",
        "simulator": True,
        "plant_doctor_configured": False,
    }


def test_simulator_seeds_nine_plants(development_client: TestClient) -> None:
    response = development_client.get("/api/v1/plants")
    assert response.status_code == 200
    payload = response.json()
    assert payload["summary"] == {
        "total": 9,
        "action_needed": 1,
        "overdue": 1,
        "sensor_issues": 1,
    }
    assert payload["plants"][0]["display_name"] == "Peace Lily"
    assert any(plant["scientific_name"] is None for plant in payload["plants"])


def test_simulator_actions_are_deduplicated(development_client: TestClient) -> None:
    response = development_client.get("/api/v1/actions")
    assert response.status_code == 200
    assert len(response.json()["actions"]) == 3


def test_simulator_exposes_sensor_entity_catalog(development_client: TestClient) -> None:
    response = development_client.get("/api/v1/home-assistant/entities")

    assert response.status_code == 200
    payload = response.json()
    assert payload["source"] == "simulator"
    assert payload["areas"] == [
        "Balcony",
        "Bedroom",
        "Kitchen",
        "Living room",
        "Outside window",
    ]
    assert len(payload["entities"]) == 36
    assert any(
        entity["entity_id"] == "sensor.golden_pothos_soil_moisture"
        and entity["device_class"] == "moisture"
        and entity["area_name"] == "Kitchen"
        and entity["device_id"] == "simulator-golden_pothos"
        for entity in payload["entities"]
    )


def test_plant_entity_mapping_can_be_updated(development_client: TestClient) -> None:
    plant = development_client.get("/api/v1/plants").json()["plants"][0]
    response = development_client.patch(
        f"/api/v1/plants/{plant['id']}/entity-mapping",
        json={
            "moisture_entity_id": "sensor.bedroom_custom_moisture",
            "temperature_entity_id": "sensor.bedroom_custom_temperature",
            "battery_entity_id": None,
            "illuminance_entity_id": None,
        },
    )

    assert response.status_code == 200
    assert response.json()["moisture_entity_id"] == "sensor.bedroom_custom_moisture"
    updated = next(
        item
        for item in development_client.get("/api/v1/plants").json()["plants"]
        if item["id"] == plant["id"]
    )
    assert updated["entity_mapping"] == response.json()


def test_plant_entity_mapping_rejects_invalid_entity_id(
    development_client: TestClient,
) -> None:
    plant = development_client.get("/api/v1/plants").json()["plants"][0]
    response = development_client.patch(
        f"/api/v1/plants/{plant['id']}/entity-mapping",
        json={"moisture_entity_id": "not an entity"},
    )

    assert response.status_code == 422


def test_manual_plant_can_be_created(development_client: TestClient) -> None:
    response = development_client.post(
        "/api/v1/plants",
        json={
            "display_name": "Test Fern",
            "location": "Office",
            "common_name": "Boston fern",
            "scientific_name": "Nephrolepis exaltata",
            "environment_type": "indoor",
        },
    )

    assert response.status_code == 201
    assert response.json()["display_name"] == "Test Fern"
    assert response.json()["state"] == "sensor_issue"
    plants = development_client.get("/api/v1/plants").json()
    assert plants["summary"]["total"] == 10
    assert plants["summary"]["sensor_issues"] == 2


def test_plant_and_sensor_mapping_can_be_created_together(
    development_client: TestClient,
) -> None:
    response = development_client.post(
        "/api/v1/plants",
        json={
            "display_name": "Kitchen Pothos",
            "location": "Kitchen",
            "common_name": "Golden pothos",
            "scientific_name": "Epipremnum aureum",
            "environment_type": "indoor",
            "entity_mapping": {
                "moisture_entity_id": "sensor.kitchen_pothos_moisture",
                "temperature_entity_id": "sensor.kitchen_pothos_temperature",
                "battery_entity_id": "sensor.kitchen_pothos_battery",
                "illuminance_entity_id": None,
            },
        },
    )

    assert response.status_code == 201
    assert response.json()["entity_mapping"] == {
        "moisture_entity_id": "sensor.kitchen_pothos_moisture",
        "temperature_entity_id": "sensor.kitchen_pothos_temperature",
        "battery_entity_id": "sensor.kitchen_pothos_battery",
        "illuminance_entity_id": None,
    }


def test_plant_photo_can_be_added_replaced_and_deleted(
    development_client: TestClient,
) -> None:
    plant = development_client.get("/api/v1/plants").json()["plants"][0]
    source = BytesIO()
    Image.new("RGB", (2400, 1200), "green").save(source, format="PNG")

    uploaded = development_client.post(
        f"/api/v1/plants/{plant['id']}/photo",
        files={"photo": ("plant.png", source.getvalue(), "image/png")},
    )

    assert uploaded.status_code == 200
    assert uploaded.json()["photo_updated_at"] is not None
    stored = development_client.get(f"/api/v1/plants/{plant['id']}/photo")
    assert stored.status_code == 200
    assert stored.headers["content-type"] == "image/jpeg"
    assert stored.headers["cache-control"] == "private, no-store"
    with Image.open(BytesIO(stored.content)) as processed:
        assert max(processed.size) == 2048
        assert not processed.getexif()

    deleted = development_client.delete(f"/api/v1/plants/{plant['id']}/photo")
    assert deleted.status_code == 204
    assert development_client.get(f"/api/v1/plants/{plant['id']}/photo").status_code == 404
    refreshed = development_client.get("/api/v1/plants").json()["plants"]
    assert next(item for item in refreshed if item["id"] == plant["id"])["photo_updated_at"] is None


def test_plant_photo_rejects_non_image_content(development_client: TestClient) -> None:
    plant = development_client.get("/api/v1/plants").json()["plants"][0]

    response = development_client.post(
        f"/api/v1/plants/{plant['id']}/photo",
        files={"photo": ("not-a-photo.jpg", b"not an image", "image/jpeg")},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "The selected file is not a valid photo."


def test_plant_photo_accepts_iphone_heic(development_client: TestClient) -> None:
    plant = development_client.get("/api/v1/plants").json()["plants"][0]
    source = BytesIO()
    Image.new("RGB", (32, 32), "green").save(source, format="HEIF")

    response = development_client.post(
        f"/api/v1/plants/{plant['id']}/photo",
        files={"photo": ("plant.heic", source.getvalue(), "image/heic")},
    )

    assert response.status_code == 200
    assert response.json()["photo_updated_at"] is not None


def test_plant_doctor_requires_explicit_consent(development_client: TestClient) -> None:
    plant = development_client.get("/api/v1/plants").json()["plants"][0]

    response = request_diagnosis(development_client, plant["id"], diagnostic_photo(), consent=False)

    assert response.status_code == 422
    assert response.json()["detail"] == "Explicit consent is required for each Plant Doctor check."


def test_plant_doctor_requires_a_separate_diagnostic_photo(
    development_client: TestClient,
) -> None:
    plant = development_client.get("/api/v1/plants").json()["plants"][0]

    response = development_client.post(
        f"/api/v1/plants/{plant['id']}/doctor", data={"consent": "true"}
    )

    assert response.status_code == 422


def test_plant_doctor_reports_missing_configuration(development_client: TestClient) -> None:
    plant = development_client.get("/api/v1/plants").json()["plants"][0]

    response = request_diagnosis(development_client, plant["id"], diagnostic_photo())

    assert response.status_code == 503
    assert "Cloudflare Account ID" in response.json()["detail"]


def test_plant_doctor_sends_reduced_photo_and_sensor_context(tmp_path: Path) -> None:
    doctor = StubPlantDoctor()
    settings = Settings(
        environment="test",
        auth_mode="disabled",
        data_dir=tmp_path,
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'doctor.db'}",
        static_dir=tmp_path / "static",
    )
    with TestClient(create_app(settings, plant_doctor_client=doctor)) as client:
        initial_usage = client.get("/api/v1/plant-doctor/usage")
        plant = client.get("/api/v1/plants").json()["plants"][1]
        initial_history = client.get(f"/api/v1/plants/{plant['id']}/doctor/history")
        current_photo = diagnostic_photo(size=(2400, 1600))

        response = request_diagnosis(client, plant["id"], current_photo)
        cover_after_diagnosis = next(
            item
            for item in client.get("/api/v1/plants").json()["plants"]
            if item["id"] == plant["id"]
        )
        updated_usage = client.get("/api/v1/plant-doctor/usage")
        visit_id = response.json()["visit_id"]
        saved_history = client.get(f"/api/v1/plants/{plant['id']}/doctor/history")
        recommendation = "Check the underside of the leaves before changing care."
        created_action = client.post(
            f"/api/v1/plants/{plant['id']}/doctor/recommendation",
            json={"recommendation": recommendation, "visit_id": visit_id},
        )
        repeated_action = client.post(
            f"/api/v1/plants/{plant['id']}/doctor/recommendation",
            json={"recommendation": recommendation},
        )
        empty_action = client.post(
            f"/api/v1/plants/{plant['id']}/doctor/recommendation",
            json={"recommendation": "   "},
        )
        feedback = client.patch(
            f"/api/v1/plants/{plant['id']}/doctor/history/{visit_id}",
            json={"outcome": "did_not_help"},
        )
        second_response = request_diagnosis(
            client, plant["id"], diagnostic_photo(color="darkgreen")
        )

    assert response.status_code == 200
    assert response.json()["neurons"] == 12.5
    assert response.json()["confidence"] == "medium"
    assert response.json()["visit_id"] is not None
    assert cover_after_diagnosis["photo_updated_at"] is None
    assert len(doctor.calls) == 2
    sent_photo, context = doctor.calls[0]
    with Image.open(BytesIO(sent_photo)) as image:
        assert max(image.size) == 1280
    assert context.display_name == plant["display_name"]
    assert context.moisture == plant["moisture"]
    assert context.history == ()
    assert doctor.calls[1][1].history[0].decision == "accepted"
    assert doctor.calls[1][1].history[0].outcome == "did_not_help"
    assert initial_usage.json()["checks_today"] == 0
    assert updated_usage.json()["checks_today"] == 1
    assert updated_usage.json()["daily_free_neuron_limit"] == 10_000
    assert updated_usage.json()["estimated_neurons_per_check"] == "about 10–50"
    assert initial_history.json() == {"visits": []}
    assert saved_history.json()["visits"][0]["decision"] == "pending"
    assert saved_history.json()["visits"][0]["sensor_snapshot"]["moisture"] == plant["moisture"]
    assert created_action.status_code == 200
    assert created_action.json()["type"] == "ai_recommendation"
    assert created_action.json()["recommendation"] == recommendation
    assert repeated_action.json()["id"] == created_action.json()["id"]
    assert empty_action.status_code == 422
    assert feedback.status_code == 200
    assert feedback.json()["decision"] == "accepted"
    assert feedback.json()["outcome"] == "did_not_help"
    assert second_response.status_code == 200


@pytest.mark.parametrize(
    ("kind", "expected_status", "message"),
    [
        ("quota", 429, "daily AI allowance"),
        ("credentials", 401, "expired, revoked"),
        ("configuration", 403, "model agreement"),
        ("capacity", 503, "out of capacity"),
        ("rate_limit", 429, "too many requests"),
        ("unavailable", 503, "could not be reached"),
    ],
)
def test_plant_doctor_provider_errors_are_actionable(
    tmp_path: Path, kind: str, expected_status: int, message: str
) -> None:
    settings = Settings(
        environment="test",
        auth_mode="disabled",
        data_dir=tmp_path,
        database_url=f"sqlite+aiosqlite:///{tmp_path / f'{kind}.db'}",
        static_dir=tmp_path / "static",
    )
    with TestClient(create_app(settings, plant_doctor_client=FailingPlantDoctor(kind))) as client:
        plant = client.get("/api/v1/plants").json()["plants"][0]
        response = request_diagnosis(client, plant["id"], diagnostic_photo())

    assert response.status_code == expected_status
    assert message in response.json()["detail"]


def test_plant_can_be_edited_and_archived_without_losing_history(
    development_client: TestClient,
) -> None:
    plant = development_client.get("/api/v1/plants").json()["plants"][0]
    updated = development_client.patch(
        f"/api/v1/plants/{plant['id']}",
        json={"display_name": "Bedroom Peace Lily", "location": "Guest room"},
    )
    assert updated.status_code == 200
    assert updated.json()["display_name"] == "Bedroom Peace Lily"

    removed = development_client.delete(f"/api/v1/plants/{plant['id']}")
    assert removed.status_code == 204
    remaining = development_client.get("/api/v1/plants").json()
    assert remaining["summary"]["total"] == 8
    assert all(item["id"] != plant["id"] for item in remaining["plants"])


def test_care_action_can_be_completed_and_reopened(development_client: TestClient) -> None:
    actions = development_client.get("/api/v1/actions").json()["actions"]
    action = next(action for action in actions if action["type"] == "clean_leaves")

    completed = development_client.post(f"/api/v1/actions/{action['id']}/complete")
    assert completed.status_code == 200
    assert completed.json()["status"] == "completed"
    assert completed.json()["completed_by"] == "Developer"
    plants = development_client.get("/api/v1/plants").json()["plants"]
    completed_plant = next(plant for plant in plants if plant["id"] == action["plant_id"])
    assert completed_plant["state"] == "good"

    repeated = development_client.post(f"/api/v1/actions/{action['id']}/complete")
    assert repeated.status_code == 200
    assert repeated.json()["completed_at"] == completed.json()["completed_at"]

    reopened = development_client.post(f"/api/v1/actions/{action['id']}/undo")
    assert reopened.status_code == 200
    assert reopened.json()["status"] == "open"
    assert reopened.json()["completed_at"] is None
    plants = development_client.get("/api/v1/plants").json()["plants"]
    reopened_plant = next(plant for plant in plants if plant["id"] == action["plant_id"])
    assert reopened_plant["state"] == "overdue"
    history = development_client.get("/api/v1/actions/history").json()["events"]
    assert [event["event_type"] for event in history[:2]] == [
        "action_reopened",
        "action_completed",
    ]


@pytest.mark.parametrize("action_type", ["low_moisture", "sensor_issue"])
def test_sensor_managed_action_cannot_be_completed_manually(
    development_client: TestClient, action_type: str
) -> None:
    actions = development_client.get("/api/v1/actions").json()["actions"]
    action = next(action for action in actions if action["type"] == action_type)

    response = development_client.post(f"/api/v1/actions/{action['id']}/complete")

    assert response.status_code == 409
    assert "managed by sensor recovery" in response.json()["detail"]
    plants = development_client.get("/api/v1/plants").json()["plants"]
    plant = next(plant for plant in plants if plant["id"] == action["plant_id"])
    assert plant["highest_priority_action"] == action["title"]


def test_snoozed_action_remains_visible_on_plant_card(development_client: TestClient) -> None:
    action = next(
        action
        for action in development_client.get("/api/v1/actions").json()["actions"]
        if action["type"] == "low_moisture"
    )
    response = development_client.post(f"/api/v1/actions/{action['id']}/snooze", json={"hours": 24})
    assert response.status_code == 200

    plants = development_client.get("/api/v1/plants").json()["plants"]
    plant = next(plant for plant in plants if plant["id"] == action["plant_id"])
    assert plant["highest_priority_action"] == action["title"]


def test_care_action_can_be_snoozed(development_client: TestClient) -> None:
    action = development_client.get("/api/v1/actions").json()["actions"][0]

    response = development_client.post(f"/api/v1/actions/{action['id']}/snooze", json={"hours": 24})

    assert response.status_code == 200
    assert response.json()["status"] == "snoozed"
    assert response.json()["snoozed_until"] is not None


def test_confirmed_simulator_watering_auto_completes_low_moisture_action(
    development_client: TestClient,
) -> None:
    actions = development_client.get("/api/v1/actions").json()["actions"]
    watering_action = next(action for action in actions if action["type"] == "low_moisture")

    response = development_client.post(
        f"/api/v1/simulator/plants/{watering_action['plant_id']}/confirmed-watering"
    )

    assert response.status_code == 200
    assert response.json()["moisture"] >= 40
    assert response.json()["state"] == "good"
    updated_action = next(
        action
        for action in development_client.get("/api/v1/actions").json()["actions"]
        if action["id"] == watering_action["id"]
    )
    assert updated_action["status"] == "completed"
    assert updated_action["completed_by"] == "Automatic moisture recovery"
    history = development_client.get("/api/v1/actions/history").json()["events"]
    assert history[0]["event_type"] == "action_auto_completed"


def test_missing_frontend_has_clear_response(development_client: TestClient) -> None:
    response = development_client.get("/dashboard")
    assert response.status_code == 404
    assert response.json()["detail"] == "Frontend not built"
