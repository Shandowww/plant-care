from datetime import datetime
from typing import Any

import httpx2

from .schemas import HomeAssistantEntity

RELEVANT_DEVICE_CLASSES = {
    "battery",
    "humidity",
    "illuminance",
    "moisture",
    "temperature",
}


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
                )
            )
    return entities


class HomeAssistantClient:
    def __init__(self, token: str | None) -> None:
        self.token = token

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
        payload = response.json()
        return [entity for item in payload if (entity := self._parse_entity(item)) is not None]

    @staticmethod
    def _parse_entity(item: Any) -> HomeAssistantEntity | None:
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
            last_updated=HomeAssistantClient._parse_timestamp(item.get("last_updated")),
        )

    @staticmethod
    def _parse_timestamp(value: Any) -> datetime | None:
        if not isinstance(value, str):
            return None
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
