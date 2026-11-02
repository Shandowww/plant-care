from datetime import UTC, datetime, timedelta

import plantcare.home_assistant as ha_module
import pytest
from plantcare.home_assistant import HomeAssistantClient
from test_sync import FakeHomeAssistant, FakeHomeAssistantNotifier, production_client


class MobileNotifier(FakeHomeAssistantNotifier):
    def __init__(self):
        super().__init__()
        self.sent = []
        self.fail = set()

    async def list_notification_devices(self):
        return ["mobile_app_phone", "mobile_app_tablet"]

    async def notify_device(self, service, payload):
        if service in self.fail:
            raise RuntimeError("Temporarily unavailable")
        self.sent.append((service, payload))


def add_plant(client):
    result = client.post(
        "/api/v1/plants",
        json={
            "display_name": "Fern",
            "location": "Office",
            "common_name": "Fern",
            "environment_type": "indoor",
            "entity_mapping": {"moisture_entity_id": "sensor.fern_moisture"},
        },
    )
    assert result.status_code == 201
    return result.json()["id"]


def test_mobile_delivery_retries_only_failed_recipient_and_clears_original_devices(tmp_path):
    source, sink = FakeHomeAssistant(), MobileNotifier()
    sink.fail.add("mobile_app_tablet")
    with production_client(tmp_path, source, sink) as client:
        assert client.get("/api/v1/notifications/devices").json() == [
            "mobile_app_phone",
            "mobile_app_tablet",
        ]
        assert (
            client.post(
                "/api/v1/notifications/preferences",
                json={
                    "devices": ["mobile_app_phone", "mobile_app_tablet"],
                    "persistent": False,
                },
            ).status_code
            == 200
        )
        plant_id = add_plant(client)
        entity = source.entities.pop(0)
        for _ in range(2):
            assert client.post("/api/v1/home-assistant/sync").status_code == 200
        assert len(sink.sent) == 1
        assert sink.created == []
        data = sink.sent[0][1]["data"]
        assert data["url"].endswith(f"#plants/{plant_id}")
        assert data["url"] == data["clickAction"]
    sink.fail.clear()
    with production_client(tmp_path, source, sink) as client:
        assert client.get("/api/v1/notifications/preferences").json()["persistent"] is False
        client.post("/api/v1/home-assistant/sync")
        assert [item[0] for item in sink.sent] == ["mobile_app_phone", "mobile_app_tablet"]
        # Clearing must use the original recipients, not new preferences.
        client.post("/api/v1/notifications/preferences", json={"devices": [], "persistent": True})
        source.entities.append(entity)
        client.post("/api/v1/home-assistant/sync")
        clears = sink.sent[2:]
        assert len(clears) == 2
        assert all(payload["message"] == "clear_notification" for _, payload in clears)
        assert all(payload["data"]["tag"] == data["tag"] for _, payload in clears)
        assert sink.dismissed == []


@pytest.mark.parametrize(
    "device", ["mobile_app_unknown", "notify.mobile_app_phone", "../restart", "restart"]
)
def test_notification_recipients_must_be_registered_mobile_services(tmp_path, device):
    with production_client(tmp_path, FakeHomeAssistant(), MobileNotifier()) as client:
        result = client.post(
            "/api/v1/notifications/preferences", json={"devices": [device], "persistent": False}
        )
        assert result.status_code == 422
        assert client.get("/api/v1/notifications/preferences").json() == {
            "devices": [],
            "persistent": True,
        }


def test_no_notification_recipients_sends_nothing(tmp_path):
    source, sink = FakeHomeAssistant(), MobileNotifier()
    with production_client(tmp_path, source, sink) as client:
        client.post("/api/v1/notifications/preferences", json={"devices": [], "persistent": False})
        add_plant(client)
        source.entities.pop(0)
        client.post("/api/v1/home-assistant/sync")
        assert sink.sent == []
        assert sink.created == []


@pytest.mark.asyncio
async def test_mobile_service_discovery_and_payload_use_supervisor_api(monkeypatch):
    calls = []

    class Response:
        def raise_for_status(self):
            pass

        def json(self):
            return [
                {
                    "domain": "notify",
                    "services": {
                        "mobile_app_phone": {},
                        "mobile_app_tablet": {},
                        "send_message": {},
                    },
                },
                {"domain": "switch", "services": {"turn_off": {}}},
            ]

    class Client:
        def __init__(self, **kwargs):
            assert kwargs["base_url"] == "http://supervisor/core/api/"
            assert kwargs["headers"] == {"Authorization": "Bearer synthetic-token"}

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def get(self, path):
            assert path == "services"
            return Response()

        async def post(self, path, *, json):
            calls.append((path, json))
            return Response()

    monkeypatch.setattr(ha_module.httpx2, "AsyncClient", Client)
    client = HomeAssistantClient("synthetic-token")
    assert await client.list_notification_devices() == ["mobile_app_phone", "mobile_app_tablet"]
    payload = {"message": "Water the fern", "data": {"tag": "plantcare_test"}}
    await client.notify_device("mobile_app_phone", payload)
    assert calls == [("services/notify/mobile_app_phone", payload)]
    with pytest.raises(ValueError):
        await client.notify_device("restart", payload)
    assert len(calls) == 1


def test_notification_settings_require_authentication(tmp_path):
    with production_client(tmp_path, FakeHomeAssistant(), MobileNotifier()) as client:
        client.headers.clear()
        client.headers["x-plantcare-surface"] = "lan"
        assert client.get("/api/v1/notifications/devices").status_code == 401
        assert client.get("/api/v1/notifications/preferences").status_code == 401
        assert (
            client.post("/api/v1/notifications/preferences", json={"devices": []}).status_code
            == 401
        )


def test_device_test_reports_partial_failure_without_saving_preferences(tmp_path):
    sink = MobileNotifier()
    sink.fail.add("mobile_app_tablet")
    with production_client(tmp_path, FakeHomeAssistant(), sink) as client:
        response = client.post(
            "/api/v1/notifications/test",
            json={"devices": ["mobile_app_phone", "mobile_app_tablet"], "persistent": False},
        )
        assert response.status_code == 200
        assert response.json() == {
            "accepted": ["mobile_app_phone"],
            "failed": ["mobile_app_tablet"],
        }
        assert client.get("/api/v1/notifications/preferences").json() == {
            "devices": [],
            "persistent": True,
        }
        assert sink.created == []
        assert sink.sent[0][1]["title"] == "PlantCare notification test"


def test_device_test_rejects_unregistered_devices_and_requires_authentication(tmp_path):
    sink = MobileNotifier()
    with production_client(tmp_path, FakeHomeAssistant(), sink) as client:
        for devices in ([], ["mobile_app_unknown"], ["restart"]):
            assert (
                client.post("/api/v1/notifications/test", json={"devices": devices}).status_code
                == 422
            )
        client.headers.clear()
        client.headers["x-plantcare-surface"] = "lan"
        assert (
            client.post(
                "/api/v1/notifications/test", json={"devices": ["mobile_app_phone"]}
            ).status_code
            == 401
        )
        assert sink.sent == []


def test_selecting_device_does_not_replay_existing_panel_alert(tmp_path):
    source, sink = FakeHomeAssistant(), MobileNotifier()
    with production_client(tmp_path, source, sink) as client:
        add_plant(client)
        source.entities.pop(0)
        client.post("/api/v1/home-assistant/sync")
        assert len(sink.created) == 1
        client.post("/api/v1/notifications/preferences", json={"devices": ["mobile_app_phone"]})
        client.post("/api/v1/home-assistant/sync")
        assert sink.sent == []
        assert len(sink.created) == 1


def test_real_alert_reaches_saved_phone_when_ingress_link_lookup_fails(tmp_path):
    class UnavailableIngressNotifier(MobileNotifier):
        async def ingress_url(self):
            raise RuntimeError("Supervisor ingress info unavailable")

    source, sink = FakeHomeAssistant(), UnavailableIngressNotifier()
    with production_client(tmp_path, source, sink) as client:
        client.post(
            "/api/v1/notifications/preferences",
            json={"devices": ["mobile_app_phone"], "persistent": True},
        )
        add_plant(client)
        entity = source.entities.pop(0)
        for _ in range(2):
            assert client.post("/api/v1/home-assistant/sync").status_code == 200
        assert len(sink.created) == 1
        assert len(sink.sent) == 1
        service, payload = sink.sent[0]
        assert service == "mobile_app_phone"
        assert payload["title"].endswith("sensor unavailable")
        assert payload["message"]
        assert "url" not in payload["data"]
        assert "clickAction" not in payload["data"]
        assert "None" not in sink.created[0]["message"]
        source.entities.append(entity)
        client.post("/api/v1/home-assistant/sync")
        assert sink.sent[1][1]["message"] == "clear_notification"
        assert len(sink.dismissed) == 1


@pytest.mark.parametrize("kind", ["low_moisture", "prolonged_wet"])
@pytest.mark.parametrize("link_available", [True, False])
def test_confirmed_care_events_push_once_to_saved_phone(tmp_path, kind, link_available):
    class Notifier(MobileNotifier):
        async def ingress_url(self):
            if not link_available:
                raise RuntimeError("Supervisor unavailable")
            return await super().ingress_url()

    source, sink = FakeHomeAssistant(), Notifier()
    now = datetime.now(UTC)
    readings = (
        [(10 / 60, "2"), (5 / 60, "3"), (0, "1")]
        if kind == "low_moisture"
        else [(26, "90"), (25, "91"), (0, "92")]
    )

    def reading(hours, value):
        observed_at = now - timedelta(hours=hours)
        source.entities[0] = source.entities[0].model_copy(
            update={
                "state": value,
                "last_changed": observed_at,
                "last_updated": observed_at,
            }
        )

    reading(*readings[0])
    with production_client(tmp_path, source, sink) as client:
        assert (
            client.post(
                "/api/v1/notifications/preferences",
                json={
                    "devices": ["mobile_app_phone"],
                    "persistent": True,
                },
            ).status_code
            == 200
        )
        plant_id = add_plant(client)
        assert (
            client.patch(
                f"/api/v1/plants/{plant_id}",
                json={
                    "wet_duration_hours_override": 24,
                },
            ).status_code
            == 200
        )
        for hours, value in readings[1:]:
            reading(hours, value)
            assert client.post("/api/v1/home-assistant/sync").status_code == 200
        actions = client.get("/api/v1/actions").json()["actions"]
        assert any(action["type"] == kind for action in actions)
        assert len(sink.sent) == 1
        assert sink.sent[0][0] == "mobile_app_phone"
        assert sink.sent[0][1]["title"] == (
            "PlantCare: water Fern" if kind == "low_moisture" else "PlantCare: Fern remains wet"
        )
        assert client.post("/api/v1/home-assistant/sync").status_code == 200
        assert len(sink.sent) == 1
