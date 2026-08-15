import enum
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utcnow() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


class PlantState(str, enum.Enum):
    GOOD = "good"
    WATCH = "watch"
    ACTION_NEEDED = "action_needed"
    OVERDUE = "overdue"
    SENSOR_ISSUE = "sensor_issue"


class ActionStatus(str, enum.Enum):
    OPEN = "open"
    SNOOZED = "snoozed"
    COMPLETED = "completed"


class Plant(Base):
    __tablename__ = "plants"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    display_name: Mapped[str] = mapped_column(String(120), index=True)
    location: Mapped[str] = mapped_column(String(120), index=True)
    common_name: Mapped[str] = mapped_column(String(120))
    scientific_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    environment_type: Mapped[str] = mapped_column(String(32), default="indoor")
    state: Mapped[str] = mapped_column(String(32), default=PlantState.GOOD.value, index=True)
    moisture: Mapped[float | None] = mapped_column(Float, nullable=True)
    moisture_status: Mapped[str] = mapped_column(String(32), default="normal")
    temperature: Mapped[float | None] = mapped_column(Float, nullable=True)
    temperature_status: Mapped[str] = mapped_column(String(32), default="normal")
    battery: Mapped[float | None] = mapped_column(Float, nullable=True)
    illuminance: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_reading_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    simulator_scenario: Mapped[str | None] = mapped_column(String(64), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    actions: Mapped[list["CareAction"]] = relationship(back_populates="plant")
    readings: Mapped[list["Reading"]] = relationship(back_populates="plant")
    entity_mapping: Mapped["PlantEntityMapping | None"] = relationship(
        back_populates="plant", cascade="all, delete-orphan", uselist=False, lazy="selectin"
    )


class PlantEntityMapping(Base):
    __tablename__ = "plant_entity_mappings"
    __table_args__ = (UniqueConstraint("plant_id", name="uq_plant_entity_mappings_plant_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    plant_id: Mapped[str] = mapped_column(ForeignKey("plants.id", ondelete="CASCADE"), index=True)
    moisture_entity_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    temperature_entity_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    battery_entity_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    illuminance_entity_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    plant: Mapped[Plant] = relationship(back_populates="entity_mapping")


class Reading(Base):
    __tablename__ = "readings"
    __table_args__ = (
        Index("ix_readings_plant_metric_observed", "plant_id", "metric", "observed_at"),
        UniqueConstraint("idempotency_key", name="uq_readings_idempotency_key"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    plant_id: Mapped[str] = mapped_column(ForeignKey("plants.id", ondelete="CASCADE"), index=True)
    entity_id: Mapped[str] = mapped_column(String(255), index=True)
    metric: Mapped[str] = mapped_column(String(32), index=True)
    value: Mapped[float] = mapped_column(Float)
    unit: Mapped[str | None] = mapped_column(String(32), nullable=True)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    ingested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    idempotency_key: Mapped[str] = mapped_column(String(600))

    plant: Mapped[Plant] = relationship(back_populates="readings")


class CareAction(Base):
    __tablename__ = "care_actions"
    __table_args__ = (
        Index("ix_care_actions_queue", "status", "due_at"),
        UniqueConstraint("deduplication_key", name="uq_care_actions_deduplication_key"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    plant_id: Mapped[str] = mapped_column(ForeignKey("plants.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(64), index=True)
    title: Mapped[str] = mapped_column(String(200))
    observation: Mapped[str] = mapped_column(Text)
    recommendation: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32), default=ActionStatus.OPEN.value, index=True)
    priority: Mapped[int] = mapped_column(default=2)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    snoozed_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    deduplication_key: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    plant: Mapped[Plant] = relationship(back_populates="actions")


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(120), primary_key=True)
    typed_value: Mapped[Any] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    actor: Mapped[str] = mapped_column(String(120))
    event_type: Mapped[str] = mapped_column(String(80), index=True)
    object_type: Mapped[str] = mapped_column(String(80))
    object_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    old_json: Mapped[Any | None] = mapped_column(JSON, nullable=True)
    new_json: Mapped[Any | None] = mapped_column(JSON, nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )
