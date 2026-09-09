from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from plantcare.config import Settings
from plantcare.main import create_app


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
        "version": "0.2.7",
        "database": "ready",
        "simulator": True,
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
    assert len(payload["entities"]) == 36
    assert any(
        entity["entity_id"] == "sensor.golden_pothos_soil_moisture"
        and entity["device_class"] == "moisture"
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
