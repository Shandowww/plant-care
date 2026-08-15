import math
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .models import Plant, Reading
from .schemas import HomeAssistantEntity

INVALID_STATES = {"", "none", "null", "unknown", "unavailable"}
MAPPING_FIELDS = {
    "moisture": "moisture_entity_id",
    "temperature": "temperature_entity_id",
    "battery": "battery_entity_id",
    "illuminance": "illuminance_entity_id",
}
CRITICAL_METRICS = {"moisture", "temperature"}


class HomeAssistantStateSource(Protocol):
    async def list_entities(self) -> list[HomeAssistantEntity]: ...


@dataclass(frozen=True)
class SyncResult:
    plants_checked: int = 0
    readings_added: int = 0
    invalid_readings: int = 0
    missing_entities: int = 0


@dataclass(frozen=True)
class NormalizedReading:
    value: float
    unit: str | None


def normalize_reading(metric: str, entity: HomeAssistantEntity) -> NormalizedReading | None:
    state = entity.state.strip()
    if state.lower() in INVALID_STATES:
        return None
    try:
        value = float(state)
    except ValueError:
        return None
    if not math.isfinite(value):
        return None

    unit = entity.unit.strip() if entity.unit else None
    if metric in {"moisture", "battery"}:
        if unit not in {None, "%"} or not 0 <= value <= 100:
            return None
        return NormalizedReading(value=value, unit="%")
    if metric == "temperature":
        if unit in {"°F", "F"}:
            value = (value - 32) * 5 / 9
        elif unit not in {None, "°C", "C"}:
            return None
        if not -50 <= value <= 80:
            return None
        return NormalizedReading(value=round(value, 3), unit="°C")
    if metric == "illuminance":
        if unit not in {None, "lx"} or value < 0:
            return None
        return NormalizedReading(value=value, unit="lx")
    return None


async def sync_mapped_readings(
    session: AsyncSession, source: HomeAssistantStateSource
) -> SyncResult:
    entities = {entity.entity_id: entity for entity in await source.list_entities()}
    plants = (
        await session.scalars(
            select(Plant)
            .options(selectinload(Plant.entity_mapping))
            .where(Plant.active.is_(True), Plant.entity_mapping.has())
        )
    ).all()

    pending: list[tuple[Plant, str, HomeAssistantEntity, NormalizedReading, datetime, str]] = []
    invalid_readings = 0
    missing_entities = 0
    for plant in plants:
        mapping = plant.entity_mapping
        if mapping is None:
            continue
        for metric, field_name in MAPPING_FIELDS.items():
            entity_id = getattr(mapping, field_name)
            if not entity_id:
                continue
            entity = entities.get(entity_id)
            if entity is None:
                missing_entities += 1
                continue
            normalized = normalize_reading(metric, entity)
            if normalized is None:
                invalid_readings += 1
                continue
            observed_at = entity.last_updated or datetime.now(UTC)
            if observed_at.tzinfo is None:
                observed_at = observed_at.replace(tzinfo=UTC)
            idempotency_key = f"{plant.id}|{metric}|{entity.entity_id}|{observed_at.isoformat()}"
            pending.append((plant, metric, entity, normalized, observed_at, idempotency_key))

    existing_keys: set[str] = set()
    if pending:
        existing_keys = set(
            await session.scalars(
                select(Reading.idempotency_key).where(
                    Reading.idempotency_key.in_([item[5] for item in pending])
                )
            )
        )

    readings_added = 0
    plants_with_critical_data: set[str] = set()
    latest_by_plant: dict[str, datetime] = {}
    for plant, metric, entity, normalized, observed_at, idempotency_key in pending:
        setattr(plant, metric, normalized.value)
        if metric == "moisture" and plant.moisture_status == "unknown":
            plant.moisture_status = "normal"
        if metric == "temperature" and plant.temperature_status == "unknown":
            plant.temperature_status = "normal"
        if metric in CRITICAL_METRICS:
            plants_with_critical_data.add(plant.id)
        latest_by_plant[plant.id] = max(latest_by_plant.get(plant.id, observed_at), observed_at)
        if idempotency_key in existing_keys:
            continue
        session.add(
            Reading(
                plant_id=plant.id,
                entity_id=entity.entity_id,
                metric=metric,
                value=normalized.value,
                unit=normalized.unit,
                observed_at=observed_at,
                idempotency_key=idempotency_key,
            )
        )
        readings_added += 1

    for plant in plants:
        if plant.id in latest_by_plant:
            plant.last_reading_at = latest_by_plant[plant.id]
        if plant.id in plants_with_critical_data and plant.state == "sensor_issue":
            plant.state = "good"

    await session.commit()
    return SyncResult(
        plants_checked=len(plants),
        readings_added=readings_added,
        invalid_readings=invalid_readings,
        missing_entities=missing_entities,
    )
