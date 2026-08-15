from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import ActionStatus, AuditEvent, CareAction, Plant, PlantEntityMapping

SIMULATED_PLANTS = [
    (
        "Balcony Left",
        "Balcony",
        "Unknown plant",
        None,
        "outdoor_exposed",
        "watch",
        31,
        25.8,
        82,
        "transient_low",
    ),
    (
        "Balcony Right",
        "Balcony",
        "Unknown plant",
        None,
        "outdoor_covered",
        "good",
        48,
        25.2,
        76,
        "normal",
    ),
    (
        "Snake Plant",
        "Living room",
        "Snake plant",
        "Dracaena trifasciata",
        "indoor",
        "good",
        34,
        24.4,
        91,
        "normal",
    ),
    (
        "Golden Pothos",
        "Kitchen shelf",
        "Golden pothos",
        "Epipremnum aureum",
        "indoor",
        "action_needed",
        18,
        24.9,
        67,
        "three_low",
    ),
    (
        "Monstera",
        "Living room",
        "Swiss cheese plant",
        "Monstera deliciosa",
        "indoor",
        "good",
        52,
        24.1,
        88,
        "watering_rise",
    ),
    (
        "Olive Tree",
        "Balcony",
        "Olive tree",
        "Olea europaea",
        "outdoor_exposed",
        "watch",
        27,
        28.3,
        59,
        "heat_forecast",
    ),
    (
        "Peace Lily",
        "Bedroom",
        "Peace lily",
        "Spathiphyllum",
        "indoor",
        "overdue",
        59,
        23.7,
        73,
        "seasonal_due",
    ),
    (
        "Window Pot",
        "Outside window",
        "Unknown plant",
        None,
        "outdoor_exposed",
        "sensor_issue",
        None,
        None,
        16,
        "stale_sensor",
    ),
    ("Bedroom Pot", "Bedroom", "Unknown plant", None, "indoor", "good", 44, 23.3, 79, "normal"),
]


async def seed_simulator(session: AsyncSession) -> None:
    count = await session.scalar(select(func.count()).select_from(Plant))
    if count:
        await reconcile_sensor_managed_actions(session)
        await ensure_simulator_mappings(session)
        return

    now = datetime.now(UTC)
    plants: list[Plant] = []
    for index, values in enumerate(SIMULATED_PLANTS):
        (
            name,
            location,
            common,
            scientific,
            environment,
            state,
            moisture,
            temp,
            battery,
            scenario,
        ) = values
        plant = Plant(
            display_name=name,
            location=location,
            common_name=common,
            scientific_name=scientific,
            environment_type=environment,
            state=state,
            moisture=moisture,
            moisture_status="low" if state == "action_needed" else "normal",
            temperature=temp,
            temperature_status="high" if scenario == "heat_forecast" else "normal",
            battery=battery,
            illuminance=(640 + index * 215) if environment != "indoor" else None,
            last_reading_at=now
            - (
                timedelta(hours=29)
                if scenario == "stale_sensor"
                else timedelta(minutes=3 + index * 4)
            ),
            simulator_scenario=scenario,
        )
        plants.append(plant)
        session.add(plant)
    await session.flush()

    by_name = {plant.display_name: plant for plant in plants}
    session.add_all(
        [
            CareAction(
                plant_id=by_name["Golden Pothos"].id,
                type="low_moisture",
                title="Check soil moisture",
                observation="Moisture is below the configured range after three readings.",
                recommendation="Check the top layer of soil and water if it is dry.",
                priority=1,
                due_at=now,
                deduplication_key="sim:golden-pothos:low-moisture",
            ),
            CareAction(
                plant_id=by_name["Peace Lily"].id,
                type="clean_leaves",
                title="Clean leaves",
                observation="The seasonal leaf-cleaning window is due.",
                recommendation="Wipe both sides of the leaves and inspect for pests.",
                priority=2,
                due_at=now - timedelta(days=2),
                deduplication_key="sim:peace-lily:clean-leaves:2026-08",
            ),
            CareAction(
                plant_id=by_name["Window Pot"].id,
                type="sensor_issue",
                title="Check sensor connection",
                observation="No valid sensor reading has arrived for more than 24 hours.",
                recommendation="Check the battery and entity mapping before changing plant care.",
                priority=1,
                due_at=now,
                deduplication_key="sim:window-pot:stale-sensor",
            ),
        ]
    )
    for plant in plants:
        session.add(simulator_mapping(plant))
    await session.commit()


def entity_slug(name: str) -> str:
    return name.lower().replace(" ", "_")


def simulator_mapping(plant: Plant) -> PlantEntityMapping:
    slug = entity_slug(plant.display_name)
    return PlantEntityMapping(
        plant_id=plant.id,
        moisture_entity_id=f"sensor.{slug}_soil_moisture",
        temperature_entity_id=f"sensor.{slug}_temperature",
        battery_entity_id=f"sensor.{slug}_battery",
        illuminance_entity_id=f"sensor.{slug}_illuminance",
    )


async def ensure_simulator_mappings(session: AsyncSession) -> None:
    simulated_names = {values[0] for values in SIMULATED_PLANTS}
    plants = (await session.scalars(select(Plant).where(Plant.active.is_(True)))).all()
    changed = False
    for plant in plants:
        if plant.display_name not in simulated_names or plant.entity_mapping is not None:
            continue
        session.add(simulator_mapping(plant))
        changed = True
    if changed:
        await session.commit()


async def reconcile_sensor_managed_actions(session: AsyncSession) -> None:
    """Repair action/state combinations created by older simulator builds."""
    rows = (
        await session.execute(
            select(CareAction, Plant)
            .join(Plant, Plant.id == CareAction.plant_id)
            .where(
                CareAction.status == ActionStatus.COMPLETED.value,
                CareAction.type.in_(("low_moisture", "sensor_issue")),
            )
        )
    ).all()
    changed = False
    for action, plant in rows:
        condition_active = (
            action.type == "low_moisture"
            and (plant.moisture_status == "low" or plant.state == "action_needed")
        ) or (action.type == "sensor_issue" and plant.state == "sensor_issue")
        if not condition_active or action.completed_by == "Automatic moisture recovery":
            continue
        old_status = action.status
        action.status = ActionStatus.OPEN.value
        action.completed_at = None
        action.completed_by = None
        session.add(
            AuditEvent(
                actor="Sensor rule reconciliation",
                event_type="action_reopened",
                object_type="care_action",
                object_id=action.id,
                old_json={"status": old_status},
                new_json={"status": action.status, "reason": "sensor_condition_still_active"},
            )
        )
        changed = True
    await session.flush()
    plants = (await session.scalars(select(Plant).where(Plant.active.is_(True)))).all()
    for plant in plants:
        if plant.state not in {"action_needed", "overdue"}:
            continue
        active_count = await session.scalar(
            select(func.count())
            .select_from(CareAction)
            .where(
                CareAction.plant_id == plant.id,
                CareAction.status.in_((ActionStatus.OPEN.value, ActionStatus.SNOOZED.value)),
            )
        )
        if not active_count and plant.moisture_status != "low":
            plant.state = "good"
            changed = True
    if changed:
        await session.commit()
