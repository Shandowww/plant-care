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
