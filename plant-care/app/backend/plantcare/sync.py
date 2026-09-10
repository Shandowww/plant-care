import math
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .models import ActionStatus, AuditEvent, CareAction, Plant, Reading
from .schemas import HomeAssistantEntity

INVALID_STATES = {"", "none", "null", "unknown", "unavailable"}
MAPPING_FIELDS = {
    "moisture": "moisture_entity_id",
    "temperature": "temperature_entity_id",
    "battery": "battery_entity_id",
    "illuminance": "illuminance_entity_id",
}
CRITICAL_METRICS = {"moisture", "temperature"}
STALE_METRICS = {"moisture", "temperature", "illuminance"}
STALE_ACTION_PREFIX = "ha:stale:"
METRIC_LABELS = {
    "moisture": "moisture",
    "temperature": "temperature",
    "illuminance": "illuminance",
}


class HomeAssistantStateSource(Protocol):
    async def list_entities(self) -> list[HomeAssistantEntity]: ...


@dataclass(frozen=True)
class SyncResult:
    plants_checked: int = 0
    readings_added: int = 0
    invalid_readings: int = 0
    missing_entities: int = 0
    notification_events: tuple["NotificationEvent", ...] = ()


@dataclass(frozen=True)
class NotificationEvent:
    operation: str
    notification_id: str
    plant_id: str
    plant_name: str
    title: str | None = None
    message: str | None = None


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
    session: AsyncSession,
    source: HomeAssistantStateSource,
    *,
    stale_after: timedelta = timedelta(hours=72),
    current_time: datetime | None = None,
) -> SyncResult:
    now = current_time or datetime.now(UTC)
    if now.tzinfo is None:
        now = now.replace(tzinfo=UTC)
    entities = {entity.entity_id: entity for entity in await source.list_entities()}
    plants = (
        await session.scalars(
            select(Plant)
            .options(selectinload(Plant.entity_mapping))
            .where(Plant.active.is_(True), Plant.entity_mapping.has())
        )
    ).all()

    pending: list[tuple[Plant, str, HomeAssistantEntity, NormalizedReading, datetime, str]] = []
    stale_readings: dict[
        str, tuple[Plant, str, HomeAssistantEntity, NormalizedReading, datetime]
    ] = {}
    monitored_stale_keys: set[str] = set()
    fresh_stale_keys: set[str] = set()
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
            stale_key = stale_action_key(plant.id, metric, entity_id)
            if metric in STALE_METRICS:
                monitored_stale_keys.add(stale_key)
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
            last_changed = entity.last_changed
            if metric in STALE_METRICS and last_changed is not None:
                if last_changed.tzinfo is None:
                    last_changed = last_changed.replace(tzinfo=UTC)
                if now - last_changed >= stale_after:
                    stale_readings[stale_key] = (plant, metric, entity, normalized, last_changed)
                else:
                    fresh_stale_keys.add(stale_key)

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

    notification_events: list[NotificationEvent] = []
    existing_stale_actions = (
        await session.scalars(
            select(CareAction).where(
                CareAction.type == "sensor_issue",
                CareAction.deduplication_key.like(f"{STALE_ACTION_PREFIX}%"),
            )
        )
    ).all()
    stale_actions_by_key = {action.deduplication_key: action for action in existing_stale_actions}
    for key, (plant, metric, _entity, normalized, last_changed) in stale_readings.items():
        action = stale_actions_by_key.get(key)
        should_notify = action is None or action.status == ActionStatus.COMPLETED.value
        age_hours = max(int((now - last_changed).total_seconds() // 3600), 0)
        metric_label = METRIC_LABELS[metric]
        value = f"{normalized.value:g}{normalized.unit or ''}"
        observation = (
            f"The mapped {metric_label} sensor has remained at {value} for "
            f"approximately {age_hours} hours."
        )
        recommendation = (
            "Check its battery, placement, Zigbee connection, and whether its value changes "
            "during a controlled test."
        )
        if action is None:
            action = CareAction(
                plant_id=plant.id,
                type="sensor_issue",
                title=f"Check {metric_label} sensor",
                observation=observation,
                recommendation=recommendation,
                status=ActionStatus.OPEN.value,
                priority=1,
                due_at=now,
                deduplication_key=key,
            )
            session.add(action)
            await session.flush()
            session.add(
                AuditEvent(
                    actor="PlantCare sensor monitor",
                    event_type="sensor_issue_created",
                    object_type="care_action",
                    object_id=action.id,
                    new_json={"status": action.status, "metric": metric},
                )
            )
        elif action.status == ActionStatus.COMPLETED.value:
            action.status = ActionStatus.OPEN.value
            action.observation = observation
            action.recommendation = recommendation
            action.due_at = now
            action.completed_at = None
            action.completed_by = None
            action.snoozed_until = None
            session.add(
                AuditEvent(
                    actor="PlantCare sensor monitor",
                    event_type="action_reopened",
                    object_type="care_action",
                    object_id=action.id,
                    old_json={"status": ActionStatus.COMPLETED.value},
                    new_json={"status": action.status, "metric": metric},
                )
            )
        if should_notify:
            notification_events.append(
                NotificationEvent(
                    operation="create",
                    notification_id=notification_id_for(key),
                    plant_id=plant.id,
                    plant_name=plant.display_name,
                    title=f"PlantCare: {plant.display_name} sensor warning",
                    message=f"{observation}\n\n{recommendation}",
                )
            )

    for action in existing_stale_actions:
        condition_resolved = (
            action.deduplication_key not in monitored_stale_keys
            or action.deduplication_key in fresh_stale_keys
        )
        if condition_resolved and action.status in {
            ActionStatus.OPEN.value,
            ActionStatus.SNOOZED.value,
        }:
            old_status = action.status
            action.status = ActionStatus.COMPLETED.value
            action.completed_at = now
            action.completed_by = "Automatic sensor recovery"
            action.snoozed_until = None
            recovered_plant = next((item for item in plants if item.id == action.plant_id), None)
            session.add(
                AuditEvent(
                    actor="PlantCare sensor monitor",
                    event_type="action_auto_completed",
                    object_type="care_action",
                    object_id=action.id,
                    old_json={"status": old_status},
                    new_json={"status": action.status, "reason": "sensor_value_changed"},
                )
            )
            notification_events.append(
                NotificationEvent(
                    operation="dismiss",
                    notification_id=notification_id_for(action.deduplication_key),
                    plant_id=action.plant_id,
                    plant_name=recovered_plant.display_name if recovered_plant else "Plant",
                )
            )

    await session.flush()
    active_actions = (
        await session.scalars(
            select(CareAction).where(
                CareAction.status.in_((ActionStatus.OPEN.value, ActionStatus.SNOOZED.value))
            )
        )
    ).all()
    active_sensor_issue_plants = {
        action.plant_id for action in active_actions if action.type == "sensor_issue"
    }
    for plant in plants:
        if plant.id in latest_by_plant:
            plant.last_reading_at = latest_by_plant[plant.id]
        if plant.id in active_sensor_issue_plants:
            plant.state = "sensor_issue"
        elif plant.id in plants_with_critical_data and plant.state == "sensor_issue":
            remaining = [action for action in active_actions if action.plant_id == plant.id]
            overdue = any(
                action.due_at is not None
                and (
                    action.due_at.replace(tzinfo=UTC)
                    if action.due_at.tzinfo is None
                    else action.due_at
                )
                < now
                for action in remaining
            )
            plant.state = "overdue" if overdue else "action_needed" if remaining else "good"

    await session.commit()
    return SyncResult(
        plants_checked=len(plants),
        readings_added=readings_added,
        invalid_readings=invalid_readings,
        missing_entities=missing_entities,
        notification_events=tuple(notification_events),
    )


def stale_action_key(plant_id: str, metric: str, entity_id: str) -> str:
    entity_digest = sha256(entity_id.encode()).hexdigest()[:16]
    return f"{STALE_ACTION_PREFIX}{plant_id}:{metric}:{entity_digest}"


def notification_id_for(action_key: str) -> str:
    return action_key.replace(":", "_")
