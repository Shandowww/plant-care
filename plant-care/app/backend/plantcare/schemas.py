from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

ENTITY_ID_PATTERN = r"^[a-z0-9_]+\.[a-z0-9_]+$"


class PlantEntityMappingSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    moisture_entity_id: str | None = None
    temperature_entity_id: str | None = None
    battery_entity_id: str | None = None
    illuminance_entity_id: str | None = None


class PlantEntityMappingUpdate(BaseModel):
    moisture_entity_id: str | None = Field(default=None, pattern=ENTITY_ID_PATTERN)
    temperature_entity_id: str | None = Field(default=None, pattern=ENTITY_ID_PATTERN)
    battery_entity_id: str | None = Field(default=None, pattern=ENTITY_ID_PATTERN)
    illuminance_entity_id: str | None = Field(default=None, pattern=ENTITY_ID_PATTERN)


class HomeAssistantEntity(BaseModel):
    entity_id: str
    name: str
    device_class: str | None
    state: str
    unit: str | None
    area_name: str | None = None
    device_id: str | None = None
    last_updated: datetime | None = None


class HomeAssistantEntityListResponse(BaseModel):
    source: str
    entities: list[HomeAssistantEntity]
    areas: list[str]


class HomeAssistantSyncResponse(BaseModel):
    plants_checked: int
    readings_added: int
    invalid_readings: int
    missing_entities: int


class ReadingSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    entity_id: str
    metric: str
    value: float
    unit: str | None
    observed_at: datetime

    @field_validator("observed_at")
    @classmethod
    def assume_utc_for_sqlite_timestamp(cls, value: datetime) -> datetime:
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value


class ReadingListResponse(BaseModel):
    readings: list[ReadingSummary]


class PlantSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    display_name: str
    location: str
    common_name: str
    scientific_name: str | None
    environment_type: str
    state: str
    moisture: float | None
    moisture_status: str
    temperature: float | None
    temperature_status: str
    battery: float | None
    illuminance: float | None
    photo_updated_at: datetime | None
    last_reading_at: datetime | None
    highest_priority_action: str | None = None
    entity_mapping: PlantEntityMappingSummary | None = None
    active: bool

    @field_validator("last_reading_at", "photo_updated_at")
    @classmethod
    def assume_utc_for_sqlite_timestamp(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value


class DashboardSummary(BaseModel):
    total: int
    action_needed: int
    overdue: int
    sensor_issues: int


class PlantListResponse(BaseModel):
    plants: list[PlantSummary]
    summary: DashboardSummary


class PlantDoctorRequest(BaseModel):
    consent: Literal[True]


class PlantDoctorResponse(BaseModel):
    visit_id: str | None = None
    summary: str
    observations: list[str]
    possible_issues: list[str]
    next_steps: list[str]
    confidence: Literal["low", "medium", "high"]
    provider: str
    model: str
    neurons: float | None = None
    disclaimer: str


class PlantDoctorUsageResponse(BaseModel):
    checks_today: int
    period_started_at: datetime
    resets_at: datetime
    daily_free_neuron_limit: int = 10_000
    estimated_neurons_per_check: str = "about 10–50"


class PlantDoctorActionRequest(BaseModel):
    recommendation: str = Field(min_length=1, max_length=1_000)
    visit_id: str | None = None


class PlantDoctorVisitSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    action_id: str | None
    summary: str
    observations: list[str]
    possible_issues: list[str]
    next_steps: list[str]
    sensor_snapshot: dict[str, float | None]
    confidence: Literal["low", "medium", "high"]
    provider: str
    model: str
    neurons: float | None
    decision: Literal["pending", "accepted", "declined"]
    outcome: Literal["not_tried", "helped", "did_not_help", "not_sure"]
    created_at: datetime

    @field_validator("created_at")
    @classmethod
    def assume_utc_for_created_at(cls, value: datetime) -> datetime:
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value


class PlantDoctorHistoryResponse(BaseModel):
    visits: list[PlantDoctorVisitSummary]


class PlantDoctorFeedbackRequest(BaseModel):
    decision: Literal["pending", "accepted", "declined"] | None = None
    outcome: Literal["not_tried", "helped", "did_not_help", "not_sure"] | None = None


class PlantCreateRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=120)
    location: str = Field(min_length=1, max_length=120)
    common_name: str = Field(min_length=1, max_length=120)
    scientific_name: str | None = Field(default=None, max_length=160)
    environment_type: str = Field(
        default="indoor", pattern="^(indoor|outdoor_covered|outdoor_exposed)$"
    )
    entity_mapping: PlantEntityMappingUpdate | None = None


class PlantUpdateRequest(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=120)
    location: str | None = Field(default=None, min_length=1, max_length=120)
    common_name: str | None = Field(default=None, min_length=1, max_length=120)
    scientific_name: str | None = Field(default=None, max_length=160)
    environment_type: str | None = Field(
        default=None, pattern="^(indoor|outdoor_covered|outdoor_exposed)$"
    )


class HealthResponse(BaseModel):
    status: str
    version: str
    database: str
    simulator: bool
    plant_doctor_configured: bool


class LoginRequest(BaseModel):
    password: str = Field(min_length=12, max_length=256)


class PasswordRequest(BaseModel):
    password: str = Field(min_length=12, max_length=256)


class SessionResponse(BaseModel):
    authenticated: bool
    surface: str
    actor: str
    csrf_token: str | None = None


class ActionSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    plant_id: str
    type: str
    title: str
    observation: str
    recommendation: str
    status: str
    priority: int
    due_at: datetime | None
    snoozed_until: datetime | None
    completed_at: datetime | None
    completed_by: str | None


class ActionSnoozeRequest(BaseModel):
    hours: int = Field(ge=1, le=24 * 30)


class ActionListResponse(BaseModel):
    actions: list[ActionSummary]


class ActionHistoryItem(BaseModel):
    id: str
    action_id: str
    actor: str
    event_type: str
    old_json: Any | None
    new_json: Any | None
    occurred_at: datetime


class ActionHistoryResponse(BaseModel):
    events: list[ActionHistoryItem]
