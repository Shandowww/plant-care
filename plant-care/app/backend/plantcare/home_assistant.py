import json
from datetime import datetime
from typing import Any, Protocol

import httpx2

from .schemas import HomeAssistantEntity


class HomeAssistantNotificationSink(Protocol):
    async def ingress_url(self) -> str: ...

    async def create_persistent_notification(
        self, *, notification_id: str, title: str, message: str
    ) -> None: ...

    async def dismiss_persistent_notification(self, *, notification_id: str) -> None: ...


RELEVANT_DEVICE_CLASSES = {
    "battery",
    "humidity",
    "illuminance",
    "moisture",
    "temperature",
}

ENTITY_METADATA_TEMPLATE = """
{% set ns = namespace(items=[], area_names=[]) %}
{% set supported = ['battery', 'humidity', 'illuminance', 'moisture', 'temperature'] %}
{% for entity in states.sensor %}
  {% if entity.attributes.device_class in supported %}
    {% set ns.items = ns.items + [{
      'entity_id': entity.entity_id,
      'area_name': area_name(entity.entity_id),
      'device_id': device_id(entity.entity_id)
    }] %}
  {% endif %}
{% endfor %}
{% for area in areas() %}
  {% set name = area_name(area) %}
  {% if name %}
    {% set ns.area_names = ns.area_names + [name] %}
  {% endif %}
{% endfor %}
{{ {'entities': ns.items, 'areas': ns.area_names} | to_json }}
""".strip()


def simulator_entities() -> list[HomeAssistantEntity]:
    plants = {
        "golden_pothos": ("Golden Pothos", "18", "24.9", "67", "unavailable"),
        "peace_lily": ("Peace Lily", "59", "23.7", "73", "unavailable"),
        "window_pot": ("Window Pot", "unavailable", "unavailable", "16", "2145"),
        "balcony_left": ("Balcony Left", "31", "25.8", "82", "640"),
        "balcony_right": ("Balcony Right", "48", "25.2", "76", "855"),
        "bedroom_pot": ("Bedroom Pot", "44", "23.3", "79", "unavailable"),
        "monstera": ("Monstera", "52", "24.1", "88", "unavailable"),
        "snake_plant": ("Snake Plant", "34", "24.4", "91", "unavailable"),
        "olive_tree": ("Olive Tree", "27", "28.3", "59", "1715"),
    }
    areas = {
        "golden_pothos": "Kitchen",
        "peace_lily": "Bedroom",
        "window_pot": "Outside window",
        "balcony_left": "Balcony",
        "balcony_right": "Balcony",
        "bedroom_pot": "Bedroom",
        "monstera": "Living room",
        "snake_plant": "Living room",
        "olive_tree": "Balcony",
    }
    entities: list[HomeAssistantEntity] = []
    definitions = (
        ("soil_moisture", "Soil moisture", "moisture", "%", 1),
        ("temperature", "Temperature", "temperature", "°C", 2),
        ("battery", "Battery", "battery", "%", 3),
        ("illuminance", "Illuminance", "illuminance", "lx", 4),
    )
    for slug, values in plants.items():
        display_name = values[0]
        for suffix, label, device_class, unit, value_index in definitions:
            entities.append(
                HomeAssistantEntity(
                    entity_id=f"sensor.{slug}_{suffix}",
                    name=f"{display_name} {label}",
                    device_class=device_class,
                    state=values[value_index],
                    unit=unit,
                    area_name=areas[slug],
                    device_id=f"simulator-{slug}",
                )
            )
    return entities


class HomeAssistantClient:
    def __init__(self, token: str | None) -> None:
        self.token = token
        self.areas: list[str] = []
        self._ingress_url: str | None = None

    async def list_entities(self) -> list[HomeAssistantEntity]:
        if not self.token:
            raise RuntimeError("Home Assistant API token is unavailable")
        async with httpx2.AsyncClient(
            base_url="http://supervisor/core/api/",
            headers={"Authorization": f"Bearer {self.token}"},
            timeout=10.0,
        ) as client:
            response = await client.get("states")
            response.raise_for_status()
            metadata = await self._entity_metadata(client)
        payload = response.json()
        entities: list[HomeAssistantEntity] = []
        for item in payload:
            item_metadata = None
            if isinstance(item, dict):
                entity_id = item.get("entity_id")
                if isinstance(entity_id, str):
                    item_metadata = metadata.get(entity_id)
            entity = self._parse_entity(item, item_metadata)
            if entity is not None:
                entities.append(entity)
        return entities

    async def _entity_metadata(
        self,
        client: httpx2.AsyncClient,
    ) -> dict[str, tuple[str | None, str | None]]:
        try:
            response = await client.post(
                "template",
                json={"template": ENTITY_METADATA_TEMPLATE},
            )
            response.raise_for_status()
            payload = json.loads(response.text)
        except Exception:
            return {}
        if not isinstance(payload, dict):
            return {}
        areas = payload.get("areas")
        if isinstance(areas, list):
            self.areas = sorted(
                {area for area in areas if isinstance(area, str) and area},
                key=str.casefold,
            )
        items = payload.get("entities")
        if not isinstance(items, list):
            return {}
        result: dict[str, tuple[str | None, str | None]] = {}
        for item in items:
            if not isinstance(item, dict) or not isinstance(item.get("entity_id"), str):
                continue
            area_name = item.get("area_name")
            device_id = item.get("device_id")
            result[item["entity_id"]] = (
                area_name if isinstance(area_name, str) and area_name else None,
                device_id if isinstance(device_id, str) and device_id else None,
            )
        return result

    @staticmethod
    def _parse_entity(
        item: Any,
        metadata: tuple[str | None, str | None] | None = None,
    ) -> HomeAssistantEntity | None:
        if not isinstance(item, dict):
            return None
        entity_id = item.get("entity_id")
        attributes = item.get("attributes")
        if not isinstance(entity_id, str) or not entity_id.startswith("sensor."):
            return None
        if not isinstance(attributes, dict):
            attributes = {}
        device_class = attributes.get("device_class")
        if device_class not in RELEVANT_DEVICE_CLASSES:
            return None
        name = attributes.get("friendly_name")
        unit = attributes.get("unit_of_measurement")
        return HomeAssistantEntity(
            entity_id=entity_id,
            name=name if isinstance(name, str) else entity_id,
            device_class=device_class,
            state=str(item.get("state", "unknown")),
            unit=unit if isinstance(unit, str) else None,
            area_name=metadata[0] if metadata else None,
            device_id=metadata[1] if metadata else None,
            last_changed=HomeAssistantClient._parse_timestamp(item.get("last_changed")),
            last_updated=HomeAssistantClient._parse_timestamp(item.get("last_updated")),
        )

    async def ingress_url(self) -> str:
        if self._ingress_url:
            return self._ingress_url
        if not self.token:
            raise RuntimeError("Home Assistant API token is unavailable")
        async with httpx2.AsyncClient(
            base_url="http://supervisor/",
            headers={"Authorization": f"Bearer {self.token}"},
            timeout=10.0,
        ) as client:
            response = await client.get("addons/self/info")
            response.raise_for_status()
        payload = response.json()
        data = payload.get("data", payload) if isinstance(payload, dict) else {}
        ingress_url = data.get("ingress_url") if isinstance(data, dict) else None
        if not isinstance(ingress_url, str) or not ingress_url:
            raise RuntimeError("PlantCare ingress URL is unavailable")
        self._ingress_url = ingress_url.rstrip("/") + "/"
        return self._ingress_url

    async def create_persistent_notification(
        self, *, notification_id: str, title: str, message: str
    ) -> None:
        await self._call_service(
            "persistent_notification",
            "create",
            {"notification_id": notification_id, "title": title, "message": message},
        )

    async def dismiss_persistent_notification(self, *, notification_id: str) -> None:
        await self._call_service(
            "persistent_notification",
            "dismiss",
            {"notification_id": notification_id},
        )

    async def _call_service(self, domain: str, service: str, payload: dict[str, Any]) -> None:
        if not self.token:
            raise RuntimeError("Home Assistant API token is unavailable")
        async with httpx2.AsyncClient(
            base_url="http://supervisor/core/api/",
            headers={"Authorization": f"Bearer {self.token}"},
            timeout=10.0,
        ) as client:
            response = await client.post(f"services/{domain}/{service}", json=payload)
            response.raise_for_status()

    @staticmethod
    def _parse_timestamp(value: Any) -> datetime | None:
        if not isinstance(value, str):
            return None
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
