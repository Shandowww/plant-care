import math
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from typing import Protocol

import structlog
from sqlalchemy import select
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .care_profiles import watering_instructions
from .models import ActionStatus, AppSetting, AuditEvent, CareAction, Plant, Reading
from .schemas import HomeAssistantEntity

logger = structlog.get_logger()

INVALID_STATES = {"", "none", "null", "unknown", "unavailable"}
MAPPING_FIELDS = {
    "moisture": "moisture_entity_id",
    "temperature": "temperature_entity_id",
    "battery": "battery_entity_id",
    "illuminance": "illuminance_entity_id",
}
STALE_METRICS = {"moisture", "temperature", "illuminance"}
STALE_ACTION_PREFIX = "ha:stale:"
LOW_MOISTURE_ACTION_PREFIX = "ha:moisture-low:"
WET_MOISTURE_ACTION_PREFIX = "ha:moisture-wet:"
LOW_BATTERY_ACTION_PREFIX = "ha:battery-low:"
LOW_MOISTURE_CONFIRMATIONS = 3
WET_MOISTURE_CONFIRMATIONS = 3
WET_MOISTURE_DURATION = timedelta(hours=24)
MOISTURE_RECOVERY_HYSTERESIS = 5
LOW_BATTERY_THRESHOLD = 20
BATTERY_RECOVERY_THRESHOLD = 25
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


@dataclass(frozen=True)
class ManagedActionSpec:
    key: str
    action_type: str
    title: str
    observation: str
    recommendation: str
    priority: int
    notification_title: str


async def activate_managed_action(
    session: AsyncSession,
    action: CareAction | None,
    plant: Plant,
    spec: ManagedActionSpec,
    now: datetime,
) -> tuple[CareAction, NotificationEvent | None]:
    should_notify = action is None or action.status == ActionStatus.COMPLETED.value
    if action is None:
        action = CareAction(
            plant_id=plant.id,
            type=spec.action_type,
            title=spec.title,
            observation=spec.observation,
            recommendation=spec.recommendation,
            status=ActionStatus.OPEN.value,
            priority=spec.priority,
            due_at=now + timedelta(hours=24),
            deduplication_key=spec.key,
        )
        session.add(action)
        await session.flush()
        session.add(
            AuditEvent(
                actor="PlantCare monitoring rules",
                event_type="care_rule_action_created",
                object_type="care_action",
                object_id=action.id,
                new_json={"status": action.status, "rule": spec.action_type},
            )
        )
    elif action.status == ActionStatus.COMPLETED.value:
        action.status = ActionStatus.OPEN.value
        action.completed_at = None
        action.completed_by = None
        action.snoozed_until = None
        action.due_at = now + timedelta(hours=24)
        session.add(
            AuditEvent(
                actor="PlantCare monitoring rules",
                event_type="action_reopened",
                object_type="care_action",
                object_id=action.id,
                old_json={"status": ActionStatus.COMPLETED.value},
                new_json={"status": action.status, "rule": spec.action_type},
            )
        )
    action.observation = spec.observation
    action.title = spec.title
    action.recommendation = spec.recommendation
    if not should_notify:
        return action, None
    return action, NotificationEvent(
        operation="create",
        notification_id=notification_id_for(spec.key),
        plant_id=plant.id,
        plant_name=plant.display_name,
        title=spec.notification_title,
        message=f"{spec.observation}\n\n{spec.recommendation}",
    )


def complete_managed_action(
    session: AsyncSession,
    action: CareAction | None,
    plant: Plant,
    now: datetime,
    *,
    completed_by: str,
    reason: str,
) -> NotificationEvent | None:
    if action is None or action.status not in {
        ActionStatus.OPEN.value,
        ActionStatus.SNOOZED.value,
    }:
        return None
    old_status = action.status
    action.status = ActionStatus.COMPLETED.value
    action.completed_at = now
    action.completed_by = completed_by
    action.snoozed_until = None
    session.add(
        AuditEvent(
            actor="PlantCare monitoring rules",
            event_type="action_auto_completed",
            object_type="care_action",
            object_id=action.id,
            old_json={"status": old_status},
            new_json={"status": action.status, "reason": reason},
        )
    )
    return NotificationEvent(
        operation="dismiss",
        notification_id=notification_id_for(action.deduplication_key),
        plant_id=plant.id,
        plant_name=plant.display_name,
    )


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
    unavailable: dict[str, Plant] = {}
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
            normalized = normalize_reading(metric, entity) if entity is not None else None
            if normalized is None:
                setattr(plant, metric, None)
                if metric in {"moisture", "temperature"}:
                    setattr(plant, f"{metric}_status", "unknown")
                unavailable[rule_action_key("ha:unavailable:", plant.id, entity_id)] = plant
            if entity is None:
                missing_entities += 1
                continue
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
    latest_by_plant: dict[str, datetime] = {}
    for plant, metric, entity, normalized, observed_at, idempotency_key in pending:
        setattr(plant, metric, normalized.value)
        if metric == "moisture" and plant.moisture_status == "unknown":
            plant.moisture_status = "normal"
        if metric == "temperature" and plant.temperature_status == "unknown":
            plant.temperature_status = "normal"
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

    # Persist the primary sensor job before optional stale-sensor monitoring.
    # A monitoring or notification-storage error must never roll back valid HA
    # values, especially the first readings for a newly mapped plant.
    for plant in plants:
        if plant.id in latest_by_plant:
            plant.last_reading_at = latest_by_plant[plant.id]
    try:
        await session.commit()
    except OperationalError as exc:
        logger.warning(
            "home_assistant_sync_database_error",
            phase="reading_ingestion",
            detail=str(exc.orig).splitlines()[0][:300],
        )
        raise

    notification_events: list[NotificationEvent] = []
    unavailable_actions = list(
        (
            await session.scalars(
                select(CareAction).where(CareAction.deduplication_key.like("ha:unavailable:%"))
            )
        ).all()
    )
    unavailable_by_key = {action.deduplication_key: action for action in unavailable_actions}
    for key, plant in unavailable.items():
        _, event = await activate_managed_action(
            session,
            unavailable_by_key.get(key),
            plant,
            ManagedActionSpec(
                key,
                "sensor_issue",
                "Check unavailable sensor",
                "A mapped sensor is missing or has no valid reading.",
                "Check the entity mapping, battery, and Home Assistant connection.",
                1,
                f"PlantCare: {plant.display_name} sensor unavailable",
            ),
            now,
        )
        if event:
            notification_events.append(event)
    for unavailable_action in unavailable_actions:
        recovered_plant = next((p for p in plants if p.id == unavailable_action.plant_id), None)
        if recovered_plant is not None and unavailable_action.deduplication_key not in unavailable:
            event = complete_managed_action(
                session,
                unavailable_action,
                recovered_plant,
                now,
                completed_by="Automatic sensor recovery",
                reason="sensor_available",
            )
            if event:
                notification_events.append(event)
    try:
        existing_stale_actions = (
            await session.scalars(
                select(CareAction).where(
                    CareAction.type == "sensor_issue",
                    CareAction.deduplication_key.like(f"{STALE_ACTION_PREFIX}%"),
                )
            )
        ).all()
    except OperationalError as exc:
        logger.warning(
            "home_assistant_sync_database_error",
            phase="sensor_monitoring",
            detail=str(exc.orig).splitlines()[0][:300],
        )
        raise
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

    managed_types = {"low_moisture", "prolonged_wet", "low_battery"}
    existing_managed_actions = (
        await session.scalars(select(CareAction).where(CareAction.type.in_(managed_types)))
    ).all()
    managed_actions_by_key = {
        action.deduplication_key: action for action in existing_managed_actions
    }
    current_managed_keys: set[str] = set()
    plants_by_id = {plant.id: plant for plant in plants}
    for plant in plants:
        mapping = plant.entity_mapping
        if mapping is None:
            continue

        moisture_entity_id = mapping.moisture_entity_id
        if moisture_entity_id:
            low_key = rule_action_key(LOW_MOISTURE_ACTION_PREFIX, plant.id, moisture_entity_id)
            wet_key = rule_action_key(WET_MOISTURE_ACTION_PREFIX, plant.id, moisture_entity_id)
            current_managed_keys.update((low_key, wet_key))
            moisture_entity = entities.get(moisture_entity_id)
            moisture_value = (
                normalize_reading("moisture", moisture_entity)
                if moisture_entity is not None
                else None
            )
            moisture_stale = (
                stale_action_key(plant.id, "moisture", moisture_entity_id) in stale_readings
            )
            if moisture_value is not None and not moisture_stale:
                recent_moisture = list(
                    (
                        await session.scalars(
                            select(Reading)
                            .where(
                                Reading.plant_id == plant.id,
                                Reading.entity_id == moisture_entity_id,
                                Reading.metric == "moisture",
                                Reading.observed_at >= now - stale_after,
                            )
                            .order_by(Reading.observed_at.desc())
                        )
                    ).all()
                )
                low_threshold = plant.moisture_check_threshold
                wet_threshold = plant.moisture_wet_threshold
                low_confirmed = len(recent_moisture) >= LOW_MOISTURE_CONFIRMATIONS and all(
                    reading.value <= low_threshold
                    for reading in recent_moisture[:LOW_MOISTURE_CONFIRMATIONS]
                )
                high_streak = []
                for reading in recent_moisture:
                    if reading.value < wet_threshold:
                        break
                    high_streak.append(reading)
                wet_confirmed = (
                    len(high_streak) >= WET_MOISTURE_CONFIRMATIONS
                    and now - as_utc(high_streak[-1].observed_at) >= WET_MOISTURE_DURATION
                )

                if low_confirmed:
                    plant.moisture_status = "low"
                    spec = ManagedActionSpec(
                        key=low_key,
                        action_type="low_moisture",
                        title="Water plant",
                        observation=(
                            f"The latest {LOW_MOISTURE_CONFIRMATIONS} readings are at or below "
                            f"this plant's {low_threshold:g}% watering-check trigger; the current "
                            f"reading is {moisture_value.value:g}%."
                        ),
                        recommendation=watering_instructions(
                            plant.scientific_name, plant.common_name
                        ),
                        priority=1,
                        notification_title=f"PlantCare: water {plant.display_name}",
                    )
                    action, event = await activate_managed_action(
                        session, managed_actions_by_key.get(low_key), plant, spec, now
                    )
                    managed_actions_by_key[low_key] = action
                    if event:
                        notification_events.append(event)
                elif moisture_value.value >= (low_threshold + MOISTURE_RECOVERY_HYSTERESIS):
                    event = complete_managed_action(
                        session,
                        managed_actions_by_key.get(low_key),
                        plant,
                        now,
                        completed_by="Automatic moisture recovery",
                        reason="moisture_recovered",
                    )
                    if event:
                        notification_events.append(event)

                if wet_confirmed:
                    plant.moisture_status = "high"
                    wet_hours = max(
                        int((now - as_utc(high_streak[-1].observed_at)).total_seconds() // 3600),
                        24,
                    )
                    spec = ManagedActionSpec(
                        key=wet_key,
                        action_type="prolonged_wet",
                        title="Help soil dry safely",
                        observation=(
                            f"Soil moisture has remained at or above this plant's "
                            f"{wet_threshold:g}% prolonged-wet trigger for at least {wet_hours} "
                            "hours."
                        ),
                        recommendation=(
                            "Pause watering, empty any standing water, check drainage, and improve "
                            "appropriate light or airflow. Inspect roots before repotting."
                        ),
                        priority=1,
                        notification_title=f"PlantCare: {plant.display_name} remains wet",
                    )
                    action, event = await activate_managed_action(
                        session, managed_actions_by_key.get(wet_key), plant, spec, now
                    )
                    managed_actions_by_key[wet_key] = action
                    if event:
                        notification_events.append(event)
                elif moisture_value.value <= (wet_threshold - MOISTURE_RECOVERY_HYSTERESIS):
                    event = complete_managed_action(
                        session,
                        managed_actions_by_key.get(wet_key),
                        plant,
                        now,
                        completed_by="Automatic moisture recovery",
                        reason="soil_dried_below_wet_threshold",
                    )
                    if event:
                        notification_events.append(event)

                if not low_confirmed and not wet_confirmed:
                    if moisture_value.value <= low_threshold:
                        plant.moisture_status = "low"
                    elif moisture_value.value >= wet_threshold:
                        plant.moisture_status = "high"
                    else:
                        plant.moisture_status = "normal"

        battery_entity_id = mapping.battery_entity_id
        if battery_entity_id:
            battery_key = rule_action_key(LOW_BATTERY_ACTION_PREFIX, plant.id, battery_entity_id)
            current_managed_keys.add(battery_key)
            battery_entity = entities.get(battery_entity_id)
            battery_value = (
                normalize_reading("battery", battery_entity) if battery_entity is not None else None
            )
            if battery_value is not None and battery_value.value < LOW_BATTERY_THRESHOLD:
                spec = ManagedActionSpec(
                    key=battery_key,
                    action_type="low_battery",
                    title="Replace sensor battery",
                    observation=(
                        f"The mapped sensor battery is {battery_value.value:g}%, below the "
                        f"{LOW_BATTERY_THRESHOLD}% warning threshold."
                    ),
                    recommendation=(
                        "Replace or recharge the sensor battery soon, then confirm that fresh "
                        "readings continue to arrive."
                    ),
                    priority=2,
                    notification_title=f"PlantCare: {plant.display_name} sensor battery is low",
                )
                action, event = await activate_managed_action(
                    session, managed_actions_by_key.get(battery_key), plant, spec, now
                )
                managed_actions_by_key[battery_key] = action
                if event:
                    notification_events.append(event)
            elif battery_value is not None and battery_value.value >= BATTERY_RECOVERY_THRESHOLD:
                event = complete_managed_action(
                    session,
                    managed_actions_by_key.get(battery_key),
                    plant,
                    now,
                    completed_by="Automatic battery recovery",
                    reason="battery_recovered",
                )
                if event:
                    notification_events.append(event)

    for action in existing_managed_actions:
        if action.deduplication_key in current_managed_keys:
            continue
        recovered_plant = plants_by_id.get(action.plant_id)
        if recovered_plant is None:
            continue
        event = complete_managed_action(
            session,
            action,
            recovered_plant,
            now,
            completed_by="Automatic mapping recovery",
            reason="sensor_mapping_removed",
        )
        if event:
            notification_events.append(event)

    await session.flush()
    active_actions = (
        await session.scalars(
            select(CareAction).where(
                CareAction.status.in_((ActionStatus.OPEN.value, ActionStatus.SNOOZED.value))
            )
        )
    ).all()
    for plant in plants:
        remaining = [action for action in active_actions if action.plant_id == plant.id]
        if any(action.type == "sensor_issue" for action in remaining):
            plant.state = "sensor_issue"
        else:
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
            plant.state = (
                "overdue"
                if overdue
                else "action_needed"
                if remaining
                else "watch"
                if plant.moisture_status in {"low", "high"}
                else "good"
            )

    # Persist delivery intent in the same transaction as the action transition.
    # A newer transition replaces an undelivered notification for the same rule.
    for event in notification_events:
        key = f"notification.pending.{event.notification_id}"
        setting = await session.scalar(select(AppSetting).where(AppSetting.key == key))
        if setting is None:
            session.add(AppSetting(key=key, typed_value=asdict(event)))
        else:
            setting.typed_value = asdict(event)
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


def rule_action_key(prefix: str, plant_id: str, entity_id: str) -> str:
    entity_digest = sha256(entity_id.encode()).hexdigest()[:16]
    return f"{prefix}{plant_id}:{entity_digest}"


def as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


def notification_id_for(action_key: str) -> str:
    return action_key.replace(":", "_")
