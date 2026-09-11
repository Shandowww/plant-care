import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated
from urllib.parse import quote

import structlog
from fastapi import (
    Depends,
    FastAPI,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import case, func, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from . import __version__
from .auth import AuthService, Identity, ensure_ingress
from .care_profiles import care_profile
from .config import Settings, get_settings
from .database import Database
from .home_assistant import (
    HomeAssistantClient,
    HomeAssistantNotificationSink,
    simulator_entities,
)
from .models import (
    ActionStatus,
    AppSetting,
    AuditEvent,
    CareAction,
    Plant,
    PlantDoctorVisit,
    PlantEntityMapping,
    Reading,
)
from .photos import (
    MAX_UPLOAD_BYTES,
    InvalidPhotoError,
    photo_path,
    prepare_photo,
    prepare_photo_for_analysis,
    store_photo,
)
from .plant_doctor import (
    CloudflarePlantDoctor,
    PlantDoctorContext,
    PlantDoctorHistoryContext,
    PlantDoctorProviderError,
    PlantDoctorSource,
)
from .schemas import (
    ActionHistoryItem,
    ActionHistoryResponse,
    ActionListResponse,
    ActionSnoozeRequest,
    ActionSummary,
    DashboardSummary,
    HealthResponse,
    HomeAssistantEntityListResponse,
    HomeAssistantSyncResponse,
    LoginRequest,
    PasswordRequest,
    PlantCreateRequest,
    PlantDoctorActionRequest,
    PlantDoctorFeedbackRequest,
    PlantDoctorHistoryResponse,
    PlantDoctorResponse,
    PlantDoctorUsageResponse,
    PlantDoctorVisitSummary,
    PlantEntityMappingSummary,
    PlantEntityMappingUpdate,
    PlantListResponse,
    PlantSummary,
    PlantUpdateRequest,
    ReadingListResponse,
    ReadingSummary,
    SessionResponse,
)
from .simulator import seed_simulator
from .sync import HomeAssistantStateSource, SyncResult, sync_mapped_readings

logger = structlog.get_logger()

AUTO_MANAGED_ACTION_TYPES = {"low_moisture", "sensor_issue"}


def database_error_detail(exc: Exception) -> str:
    """Return the driver message without SQL parameters or request credentials."""
    original = exc.orig if isinstance(exc, OperationalError) else exc
    return str(original).splitlines()[0][:300]


def create_app(
    settings: Settings | None = None,
    home_assistant_client: HomeAssistantStateSource | None = None,
    plant_doctor_client: PlantDoctorSource | None = None,
    home_assistant_notifier: HomeAssistantNotificationSink | None = None,
) -> FastAPI:
    app_settings = settings or get_settings()
    app_settings.data_dir.mkdir(parents=True, exist_ok=True)
    database = Database(app_settings)
    auth = AuthService(app_settings)
    home_assistant = home_assistant_client or HomeAssistantClient(app_settings.supervisor_token)
    notification_sink = home_assistant_notifier
    if notification_sink is None and isinstance(home_assistant, HomeAssistantClient):
        notification_sink = home_assistant
    notifications_enabled = (
        app_settings.home_assistant_notifications
        and not app_settings.simulator_enabled
        and notification_sink is not None
    )
    cloudflare_token = (
        app_settings.cloudflare_api_token.get_secret_value().strip()
        if app_settings.cloudflare_api_token
        else ""
    )
    plant_doctor = plant_doctor_client
    if plant_doctor is None and app_settings.cloudflare_account_id and cloudflare_token:
        plant_doctor = CloudflarePlantDoctor(
            account_id=app_settings.cloudflare_account_id,
            api_token=cloudflare_token,
        )
    sync_lock = asyncio.Lock()

    async def sync_once() -> SyncResult:
        async with sync_lock:
            for attempt in range(3):
                try:
                    async with database.session_factory() as sync_session:
                        result = await sync_mapped_readings(
                            sync_session,
                            home_assistant,
                            stale_after=timedelta(hours=app_settings.stale_sensor_hours),
                        )
                    break
                except OperationalError as exc:
                    detail = database_error_detail(exc)
                    database_busy = "locked" in detail.casefold() or "busy" in detail.casefold()
                    if not database_busy or attempt == 2:
                        raise
                    logger.warning(
                        "home_assistant_sync_database_busy",
                        attempt=attempt + 1,
                        detail=detail,
                    )
                    await asyncio.sleep(0.25 * (attempt + 1))
        if notifications_enabled and notification_sink is not None:
            for event in result.notification_events:
                try:
                    if event.operation == "dismiss":
                        await notification_sink.dismiss_persistent_notification(
                            notification_id=event.notification_id
                        )
                        continue
                    ingress_url = await notification_sink.ingress_url()
                    plant_url = f"{ingress_url}#plants/{quote(event.plant_id, safe='')}"
                    message = f"{event.message}\n\n[Open this plant in PlantCare]({plant_url})"
                    await notification_sink.create_persistent_notification(
                        notification_id=event.notification_id,
                        title=event.title or "PlantCare sensor warning",
                        message=message,
                    )
                except Exception as exc:
                    logger.warning(
                        "home_assistant_notification_failed",
                        operation=event.operation,
                        plant_id=event.plant_id,
                        error=type(exc).__name__,
                    )
        return result

    async def sync_loop() -> None:
        while True:
            try:
                result = await sync_once()
                logger.debug(
                    "home_assistant_sync_complete",
                    plants_checked=result.plants_checked,
                    readings_added=result.readings_added,
                    invalid_readings=result.invalid_readings,
                    missing_entities=result.missing_entities,
                )
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning(
                    "home_assistant_sync_failed",
                    error=type(exc).__name__,
                    detail=database_error_detail(exc),
                )
            await asyncio.sleep(app_settings.sync_interval_seconds)

    async def sync_after_mapping_change(plant_id: str) -> None:
        """Hydrate a newly saved mapping without making plant edits depend on HA uptime."""
        if app_settings.simulator_enabled or not app_settings.supervisor_token:
            return
        try:
            result = await sync_once()
            logger.info(
                "home_assistant_mapping_sync_complete",
                plant_id=plant_id,
                readings_added=result.readings_added,
                invalid_readings=result.invalid_readings,
                missing_entities=result.missing_entities,
            )
        except Exception as exc:
            logger.warning(
                "home_assistant_mapping_sync_failed",
                plant_id=plant_id,
                error=type(exc).__name__,
                detail=database_error_detail(exc),
            )

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        sync_task: asyncio.Task[None] | None = None
        await database.initialize()
        if app_settings.simulator_enabled:
            async with database.session_factory() as simulator_session:
                await seed_simulator(simulator_session)
        logger.info(
            "application_ready", version=__version__, simulator=app_settings.simulator_enabled
        )
        if not app_settings.simulator_enabled and app_settings.supervisor_token:
            sync_task = asyncio.create_task(sync_loop(), name="home-assistant-sync")
        try:
            yield
        finally:
            if sync_task is not None:
                sync_task.cancel()
                try:
                    await sync_task
                except asyncio.CancelledError:
                    pass
            await database.close()

    application = FastAPI(
        title="Plant Care Dashboard API",
        version=__version__,
        docs_url="/api/docs" if app_settings.environment != "production" else None,
        redoc_url=None,
        lifespan=lifespan,
    )
    application.state.database = database
    application.state.auth = auth
    application.state.settings = app_settings
    application.state.home_assistant = home_assistant
    application.state.plant_doctor = plant_doctor

    async def get_session() -> AsyncIterator[AsyncSession]:
        async for session in database.session():
            yield session

    Session = Annotated[AsyncSession, Depends(get_session)]

    async def get_identity(request: Request, session: Session) -> Identity:
        identity = await auth.identity(request, session)
        auth.require_csrf(request, identity)
        return identity

    CurrentIdentity = Annotated[Identity, Depends(get_identity)]

    @application.get("/api/v1/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        return HealthResponse(
            status="ready",
            version=__version__,
            database="ready",
            simulator=app_settings.simulator_enabled,
            plant_doctor_configured=plant_doctor is not None,
            home_assistant_notifications_enabled=notifications_enabled,
            stale_sensor_hours=app_settings.stale_sensor_hours,
        )

    @application.get("/api/v1/auth/session", response_model=SessionResponse)
    async def auth_session(identity: CurrentIdentity) -> SessionResponse:
        return SessionResponse(
            authenticated=True,
            surface=identity.surface,
            actor=identity.actor,
        )

    @application.post("/api/v1/auth/login", response_model=SessionResponse)
    async def login(
        payload: LoginRequest, request: Request, response: Response, session: Session
    ) -> SessionResponse:
        if app_settings.auth_mode == "disabled" and not app_settings.environment == "production":
            return SessionResponse(authenticated=True, surface="development", actor="Developer")
        if auth.surface(request) != "lan":
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
        key = auth.rate_limit_key(request)
        auth.check_login_delay(key)
        if not await auth.verify_password(session, payload.password):
            auth.record_failure(key)
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid password")
        auth.failures.pop(key, None)
        csrf = auth.create_session(response, await auth.session_version(session))
        return SessionResponse(
            authenticated=True, surface="lan", actor="Household (LAN)", csrf_token=csrf
        )

    @application.post("/api/v1/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
    async def logout(response: Response) -> None:
        auth.clear_session(response)

    @application.post("/api/v1/auth/password", status_code=status.HTTP_204_NO_CONTENT)
    async def set_password(
        payload: PasswordRequest, identity: CurrentIdentity, session: Session
    ) -> None:
        ensure_ingress(identity)
        await auth.set_password(session, payload.password, identity.actor)

    @application.post("/api/v1/auth/logout-all", status_code=status.HTTP_204_NO_CONTENT)
    async def logout_all(identity: CurrentIdentity, session: Session) -> None:
        ensure_ingress(identity)
        setting = await session.scalar(
            select(AppSetting).where(AppSetting.key == "auth.session_version")
        )
        if setting:
            setting.typed_value = int(setting.typed_value) + 1
        else:
            session.add(AppSetting(key="auth.session_version", typed_value=2))
        session.add(
            AuditEvent(
                actor=identity.actor,
                event_type="lan_sessions_revoked",
                object_type="authentication",
            )
        )
        await session.commit()

    @application.get("/api/v1/plants", response_model=PlantListResponse)
    async def list_plants(identity: CurrentIdentity, session: Session) -> PlantListResponse:
        del identity
        action_subquery = (
            select(CareAction.plant_id, func.min(CareAction.title).label("action_title"))
            .where(CareAction.status.in_((ActionStatus.OPEN.value, ActionStatus.SNOOZED.value)))
            .group_by(CareAction.plant_id)
            .subquery()
        )
        rows = (
            await session.execute(
                select(Plant, action_subquery.c.action_title)
                .options(selectinload(Plant.entity_mapping))
                .outerjoin(action_subquery, action_subquery.c.plant_id == Plant.id)
                .where(Plant.active.is_(True))
                .order_by(
                    case(
                        (Plant.state == "overdue", 0),
                        (Plant.state == "action_needed", 1),
                        (Plant.state == "sensor_issue", 2),
                        (Plant.state == "watch", 3),
                        else_=4,
                    ),
                    Plant.display_name,
                )
            )
        ).all()
        plants = []
        for plant, action_title in rows:
            effective_state = plant.state
            if (
                action_title is None
                and plant.state in {"action_needed", "overdue"}
                and plant.moisture_status != "low"
            ):
                effective_state = "good"
            plants.append(
                PlantSummary.model_validate(plant).model_copy(
                    update={
                        "highest_priority_action": action_title,
                        "state": effective_state,
                    }
                )
            )
        return PlantListResponse(
            plants=plants,
            summary=DashboardSummary(
                total=len(plants),
                action_needed=sum(plant.state == "action_needed" for plant in plants),
                overdue=sum(plant.state == "overdue" for plant in plants),
                sensor_issues=sum(plant.state == "sensor_issue" for plant in plants),
            ),
        )

    @application.get(
        "/api/v1/home-assistant/entities",
        response_model=HomeAssistantEntityListResponse,
    )
    async def list_home_assistant_entities(
        identity: CurrentIdentity,
    ) -> HomeAssistantEntityListResponse:
        del identity
        if app_settings.simulator_enabled:
            entities = simulator_entities()
            return HomeAssistantEntityListResponse(
                source="simulator",
                entities=entities,
                areas=sorted(
                    {entity.area_name for entity in entities if entity.area_name},
                    key=str.casefold,
                ),
            )
        try:
            entities = await home_assistant.list_entities()
        except Exception as exc:
            logger.warning("home_assistant_entity_discovery_failed", error=type(exc).__name__)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Home Assistant entities could not be loaded",
            ) from exc
        discovered_areas = (
            home_assistant.areas if isinstance(home_assistant, HomeAssistantClient) else []
        )
        return HomeAssistantEntityListResponse(
            source="home_assistant",
            entities=entities,
            areas=discovered_areas
            or sorted(
                {entity.area_name for entity in entities if entity.area_name},
                key=str.casefold,
            ),
        )

    @application.post(
        "/api/v1/home-assistant/sync",
        response_model=HomeAssistantSyncResponse,
    )
    async def synchronize_home_assistant(
        identity: CurrentIdentity,
    ) -> HomeAssistantSyncResponse:
        del identity
        if app_settings.simulator_enabled:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
        try:
            result = await sync_once()
        except Exception as exc:
            logger.warning(
                "home_assistant_manual_sync_failed",
                error=type(exc).__name__,
                detail=database_error_detail(exc),
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Home Assistant readings could not be synchronized",
            ) from exc
        return HomeAssistantSyncResponse(
            plants_checked=result.plants_checked,
            readings_added=result.readings_added,
            invalid_readings=result.invalid_readings,
            missing_entities=result.missing_entities,
        )

    @application.patch(
        "/api/v1/plants/{plant_id}/entity-mapping",
        response_model=PlantEntityMappingSummary,
    )
    async def update_plant_entity_mapping(
        plant_id: str,
        payload: PlantEntityMappingUpdate,
        identity: CurrentIdentity,
        session: Session,
    ) -> PlantEntityMappingSummary:
        plant = await session.scalar(
            select(Plant)
            .options(selectinload(Plant.entity_mapping))
            .where(Plant.id == plant_id, Plant.active.is_(True))
        )
        if plant is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plant not found")
        old_values = (
            PlantEntityMappingSummary.model_validate(plant.entity_mapping).model_dump()
            if plant.entity_mapping
            else PlantEntityMappingSummary().model_dump()
        )
        mapping = plant.entity_mapping or PlantEntityMapping(plant_id=plant.id)
        changes = payload.model_dump()
        for field, value in changes.items():
            setattr(mapping, field, value)
        if plant.entity_mapping is None:
            plant.entity_mapping = mapping
            session.add(mapping)
        session.add(
            AuditEvent(
                actor=identity.actor,
                event_type="plant_entity_mapping_updated",
                object_type="plant",
                object_id=plant.id,
                old_json=old_values,
                new_json=changes,
            )
        )
        await session.commit()
        await session.refresh(mapping)
        await sync_after_mapping_change(plant.id)
        return PlantEntityMappingSummary.model_validate(mapping)

    @application.post(
        "/api/v1/plants", response_model=PlantSummary, status_code=status.HTTP_201_CREATED
    )
    async def create_plant(
        payload: PlantCreateRequest, identity: CurrentIdentity, session: Session
    ) -> PlantSummary:
        plant = Plant(
            display_name=payload.display_name.strip(),
            location=payload.location.strip(),
            common_name=payload.common_name.strip(),
            scientific_name=(payload.scientific_name or "").strip() or None,
            environment_type=payload.environment_type,
            state="sensor_issue",
            moisture_status="unknown",
            temperature_status="unknown",
        )
        session.add(plant)
        await session.flush()
        if payload.entity_mapping is not None:
            plant.entity_mapping = PlantEntityMapping(
                plant_id=plant.id,
                **payload.entity_mapping.model_dump(),
            )
        session.add(
            AuditEvent(
                actor=identity.actor,
                event_type="plant_created",
                object_type="plant",
                object_id=plant.id,
                new_json={
                    "display_name": plant.display_name,
                    "location": plant.location,
                    "entity_mapping": (
                        payload.entity_mapping.model_dump()
                        if payload.entity_mapping is not None
                        else None
                    ),
                },
            )
        )
        await session.commit()
        if payload.entity_mapping is not None:
            await sync_after_mapping_change(plant.id)
        await session.refresh(plant)
        return PlantSummary.model_validate(plant)

    @application.patch("/api/v1/plants/{plant_id}", response_model=PlantSummary)
    async def update_plant(
        plant_id: str,
        payload: PlantUpdateRequest,
        identity: CurrentIdentity,
        session: Session,
    ) -> PlantSummary:
        plant = await session.get(Plant, plant_id)
        if plant is None or not plant.active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plant not found")
        old_values = {
            "display_name": plant.display_name,
            "location": plant.location,
            "common_name": plant.common_name,
            "scientific_name": plant.scientific_name,
            "environment_type": plant.environment_type,
        }
        changes = payload.model_dump(exclude_unset=True)
        for field, value in changes.items():
            if isinstance(value, str):
                value = value.strip() or None
            setattr(plant, field, value)
        session.add(
            AuditEvent(
                actor=identity.actor,
                event_type="plant_updated",
                object_type="plant",
                object_id=plant.id,
                old_json=old_values,
                new_json=changes,
            )
        )
        await session.commit()
        await session.refresh(plant)
        return PlantSummary.model_validate(plant)

    @application.delete("/api/v1/plants/{plant_id}", status_code=status.HTTP_204_NO_CONTENT)
    async def archive_plant(plant_id: str, identity: CurrentIdentity, session: Session) -> Response:
        plant = await session.get(Plant, plant_id)
        if plant is None or not plant.active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plant not found")
        plant.active = False
        session.add(
            AuditEvent(
                actor=identity.actor,
                event_type="plant_archived",
                object_type="plant",
                object_id=plant.id,
                old_json={"active": True},
                new_json={"active": False},
            )
        )
        await session.commit()
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @application.post("/api/v1/plants/{plant_id}/photo", response_model=PlantSummary)
    async def upload_plant_photo(
        plant_id: str,
        photo: Annotated[UploadFile, File()],
        identity: CurrentIdentity,
        session: Session,
    ) -> PlantSummary:
        plant = await session.get(Plant, plant_id)
        if plant is None or not plant.active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plant not found")
        try:
            uploaded = await photo.read(MAX_UPLOAD_BYTES + 1)
        finally:
            await photo.close()
        try:
            processed = await asyncio.to_thread(prepare_photo, uploaded)
        except InvalidPhotoError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=str(exc),
            ) from exc
        target = photo_path(app_settings.data_dir, plant.id)
        await asyncio.to_thread(store_photo, target, processed)
        previous_photo = plant.photo_updated_at
        plant.photo_updated_at = datetime.now(UTC)
        session.add(
            AuditEvent(
                actor=identity.actor,
                event_type="plant_photo_replaced" if previous_photo else "plant_photo_added",
                object_type="plant",
                object_id=plant.id,
                old_json={"photo_updated_at": previous_photo.isoformat()}
                if previous_photo
                else None,
                new_json={
                    "photo_updated_at": plant.photo_updated_at.isoformat(),
                    "stored_bytes": len(processed),
                },
            )
        )
        await session.commit()
        await session.refresh(plant)
        return PlantSummary.model_validate(plant)

    @application.get("/api/v1/plants/{plant_id}/photo", response_class=FileResponse)
    async def get_plant_photo(
        plant_id: str, identity: CurrentIdentity, session: Session
    ) -> FileResponse:
        del identity
        plant = await session.get(Plant, plant_id)
        target = photo_path(app_settings.data_dir, plant_id)
        if (
            plant is None
            or not plant.active
            or plant.photo_updated_at is None
            or not target.is_file()
        ):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Photo not found")
        return FileResponse(
            target,
            media_type="image/jpeg",
            headers={
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
            },
        )

    @application.delete("/api/v1/plants/{plant_id}/photo", status_code=status.HTTP_204_NO_CONTENT)
    async def delete_plant_photo(
        plant_id: str, identity: CurrentIdentity, session: Session
    ) -> Response:
        plant = await session.get(Plant, plant_id)
        if plant is None or not plant.active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plant not found")
        if plant.photo_updated_at is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Photo not found")
        previous_photo = plant.photo_updated_at
        plant.photo_updated_at = None
        session.add(
            AuditEvent(
                actor=identity.actor,
                event_type="plant_photo_deleted",
                object_type="plant",
                object_id=plant.id,
                old_json={"photo_updated_at": previous_photo.isoformat()},
                new_json={"photo_updated_at": None},
            )
        )
        await session.commit()
        await asyncio.to_thread(photo_path(app_settings.data_dir, plant.id).unlink, missing_ok=True)
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @application.post(
        "/api/v1/plants/{plant_id}/doctor",
        response_model=PlantDoctorResponse,
    )
    async def diagnose_plant(
        plant_id: str,
        photo: Annotated[UploadFile, File()],
        consent: Annotated[bool, Form()],
        identity: CurrentIdentity,
        session: Session,
    ) -> PlantDoctorResponse:
        if not consent:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Explicit consent is required for each Plant Doctor check.",
            )
        plant = await session.get(Plant, plant_id)
        if plant is None or not plant.active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plant not found")
        if plant_doctor is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=(
                    "Plant Doctor is not configured. Add your Cloudflare Account ID and API "
                    "token in the add-on configuration."
                ),
            )
        try:
            try:
                uploaded = await photo.read(MAX_UPLOAD_BYTES + 1)
            finally:
                await photo.close()
            analysis_photo = await asyncio.to_thread(prepare_photo_for_analysis, uploaded)
            previous_visits = list(
                (
                    await session.scalars(
                        select(PlantDoctorVisit)
                        .where(PlantDoctorVisit.plant_id == plant.id)
                        .order_by(PlantDoctorVisit.created_at.desc())
                        .limit(5)
                    )
                ).all()
            )
            profile = care_profile(
                plant.scientific_name,
                plant.common_name,
                plant.environment_type,
            )
            assessment = await plant_doctor.analyze(
                analysis_photo,
                PlantDoctorContext(
                    display_name=plant.display_name,
                    common_name=plant.common_name,
                    scientific_name=plant.scientific_name,
                    location=plant.location,
                    environment_type=plant.environment_type,
                    moisture=plant.moisture,
                    temperature=plant.temperature,
                    illuminance=plant.illuminance,
                    temperature_range_celsius=(
                        profile.temperature_minimum,
                        profile.temperature_maximum,
                    ),
                    soil_moisture_sensor_range_percent=(
                        profile.moisture_minimum,
                        profile.moisture_maximum,
                    ),
                    care_profile_basis=profile.basis,
                    history=tuple(
                        PlantDoctorHistoryContext(
                            checked_at=visit.created_at.isoformat(),
                            summary=visit.summary,
                            recommendation=" · ".join(visit.next_steps),
                            decision=visit.decision,
                            outcome=visit.outcome,
                        )
                        for visit in previous_visits
                    ),
                ),
            )
        except InvalidPhotoError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=str(exc),
            ) from exc
        except PlantDoctorProviderError as exc:
            logger.warning("plant_doctor_request_failed", provider="cloudflare", reason=exc.kind)
            if exc.kind == "quota":
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=(
                        "The Cloudflare daily AI allowance has been reached. Try again tomorrow."
                    ),
                ) from exc
            if exc.kind == "credentials":
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail=(
                        "Cloudflare rejected the Plant Doctor token. It may be expired, revoked, "
                        "or missing Workers AI permissions; replace it in the app configuration."
                    ),
                ) from exc
            if exc.kind == "configuration":
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=(
                        "Cloudflare has not enabled this AI model for the account. Check the model "
                        "agreement, account access, and Workers plan in Cloudflare."
                    ),
                ) from exc
            if exc.kind == "capacity":
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail=(
                        "Cloudflare Workers AI is temporarily out of capacity. Your daily "
                        "allowance was not identified as the cause; try again shortly."
                    ),
                ) from exc
            if exc.kind == "rate_limit":
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=(
                        "Cloudflare is receiving too many requests. Wait a minute and try again."
                    ),
                ) from exc
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=(
                    "Cloudflare Workers AI could not be reached or did not return a valid "
                    "assessment. The service may be unavailable; try again shortly."
                ),
            ) from exc
        visit = PlantDoctorVisit(
            plant_id=plant.id,
            summary=assessment.summary,
            observations=assessment.observations,
            possible_issues=assessment.possible_issues,
            next_steps=assessment.next_steps,
            sensor_snapshot={
                "moisture": plant.moisture,
                "temperature": plant.temperature,
                "illuminance": plant.illuminance,
            },
            confidence=assessment.confidence,
            provider=assessment.provider,
            model=assessment.model,
            neurons=assessment.neurons,
            decision="pending",
            outcome="not_tried",
        )
        session.add(visit)
        await session.flush()
        session.add(
            AuditEvent(
                actor=identity.actor,
                event_type="plant_doctor_completed",
                object_type="plant",
                object_id=plant.id,
                new_json={
                    "provider": assessment.provider,
                    "model": assessment.model,
                    "confidence": assessment.confidence,
                    "neurons": assessment.neurons,
                },
            )
        )
        await session.commit()
        return assessment.model_copy(update={"visit_id": visit.id})

    @application.get(
        "/api/v1/plants/{plant_id}/doctor/history",
        response_model=PlantDoctorHistoryResponse,
    )
    async def plant_doctor_history(
        plant_id: str,
        identity: CurrentIdentity,
        session: Session,
        limit: Annotated[int, Query(ge=1, le=10)] = 5,
    ) -> PlantDoctorHistoryResponse:
        del identity
        plant = await session.get(Plant, plant_id)
        if plant is None or not plant.active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plant not found")
        visits = list(
            (
                await session.scalars(
                    select(PlantDoctorVisit)
                    .where(PlantDoctorVisit.plant_id == plant.id)
                    .order_by(PlantDoctorVisit.created_at.desc())
                    .limit(limit)
                )
            ).all()
        )
        return PlantDoctorHistoryResponse(
            visits=[PlantDoctorVisitSummary.model_validate(visit) for visit in visits]
        )

    @application.patch(
        "/api/v1/plants/{plant_id}/doctor/history/{visit_id}",
        response_model=PlantDoctorVisitSummary,
    )
    async def update_plant_doctor_feedback(
        plant_id: str,
        visit_id: str,
        payload: PlantDoctorFeedbackRequest,
        identity: CurrentIdentity,
        session: Session,
    ) -> PlantDoctorVisitSummary:
        visit = await session.scalar(
            select(PlantDoctorVisit).where(
                PlantDoctorVisit.id == visit_id,
                PlantDoctorVisit.plant_id == plant_id,
            )
        )
        if visit is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Doctor visit not found"
            )
        if payload.decision is None and payload.outcome is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Choose a recommendation decision or outcome.",
            )
        old_json = {"decision": visit.decision, "outcome": visit.outcome}
        next_decision = payload.decision or visit.decision
        next_outcome = payload.outcome or visit.outcome
        if next_outcome != "not_tried" and next_decision != "accepted":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Only an accepted recommendation can have a care outcome.",
            )
        if payload.decision is not None:
            visit.decision = payload.decision
            if payload.decision == "declined":
                visit.outcome = "not_tried"
        if payload.outcome is not None:
            visit.outcome = payload.outcome
        session.add(
            AuditEvent(
                actor=identity.actor,
                event_type="plant_doctor_feedback_updated",
                object_type="plant_doctor_visit",
                object_id=visit.id,
                old_json=old_json,
                new_json={"decision": visit.decision, "outcome": visit.outcome},
            )
        )
        await session.commit()
        await session.refresh(visit)
        return PlantDoctorVisitSummary.model_validate(visit)

    @application.get(
        "/api/v1/plant-doctor/usage",
        response_model=PlantDoctorUsageResponse,
    )
    async def plant_doctor_usage(
        identity: CurrentIdentity,
        session: Session,
    ) -> PlantDoctorUsageResponse:
        del identity
        now = datetime.now(UTC)
        period_started_at = now.replace(hour=0, minute=0, second=0, microsecond=0)
        checks_today = await session.scalar(
            select(func.count(AuditEvent.id)).where(
                AuditEvent.event_type == "plant_doctor_completed",
                AuditEvent.occurred_at >= period_started_at,
            )
        )
        return PlantDoctorUsageResponse(
            checks_today=int(checks_today or 0),
            period_started_at=period_started_at,
            resets_at=period_started_at + timedelta(days=1),
        )

    @application.post(
        "/api/v1/plants/{plant_id}/doctor/recommendation",
        response_model=ActionSummary,
    )
    async def add_plant_doctor_recommendation(
        plant_id: str,
        payload: PlantDoctorActionRequest,
        identity: CurrentIdentity,
        session: Session,
    ) -> ActionSummary:
        plant = await session.get(Plant, plant_id)
        if plant is None or not plant.active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plant not found")
        recommendation = payload.recommendation.strip()
        if not recommendation:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="The AI recommendation cannot be empty.",
            )
        doctor_visit = None
        if payload.visit_id:
            doctor_visit = await session.scalar(
                select(PlantDoctorVisit).where(
                    PlantDoctorVisit.id == payload.visit_id,
                    PlantDoctorVisit.plant_id == plant.id,
                )
            )
            if doctor_visit is None:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail="The Plant Doctor history entry was not found.",
                )
        existing = await session.scalar(
            select(CareAction).where(
                CareAction.plant_id == plant.id,
                CareAction.type == "ai_recommendation",
                CareAction.recommendation == recommendation,
                CareAction.status.in_((ActionStatus.OPEN.value, ActionStatus.SNOOZED.value)),
            )
        )
        if existing is not None:
            if doctor_visit is not None:
                doctor_visit.action_id = existing.id
                doctor_visit.decision = "accepted"
                await session.commit()
            return ActionSummary.model_validate(existing)
        now = datetime.now(UTC)
        action = CareAction(
            plant_id=plant.id,
            type="ai_recommendation",
            title="Review AI recommendation",
            observation=(
                "Suggested by Plant Doctor from a photo assessment. "
                "Verify it directly before changing care."
            ),
            recommendation=recommendation,
            status=ActionStatus.OPEN.value,
            priority=3,
            due_at=now,
            deduplication_key=f"plant-doctor:{plant.id}:{now.isoformat()}",
        )
        session.add(action)
        await session.flush()
        if doctor_visit is not None:
            doctor_visit.action_id = action.id
            doctor_visit.decision = "accepted"
        session.add(
            AuditEvent(
                actor=identity.actor,
                event_type="ai_recommendation_created",
                object_type="care_action",
                object_id=action.id,
                new_json={"status": action.status, "source": "plant_doctor"},
            )
        )
        if plant.state in {"good", "watch"}:
            plant.state = "action_needed"
        await session.commit()
        await session.refresh(action)
        return ActionSummary.model_validate(action)

    @application.get(
        "/api/v1/plants/{plant_id}/readings",
        response_model=ReadingListResponse,
    )
    async def plant_readings(
        plant_id: str,
        identity: CurrentIdentity,
        session: Session,
        metric: str | None = Query(
            default=None, pattern="^(moisture|temperature|battery|illuminance)$"
        ),
        limit: int = Query(default=200, ge=1, le=2000),
    ) -> ReadingListResponse:
        del identity
        plant_exists = await session.scalar(
            select(Plant.id).where(Plant.id == plant_id, Plant.active.is_(True))
        )
        if plant_exists is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plant not found")
        statement = select(Reading).where(Reading.plant_id == plant_id)
        if metric:
            statement = statement.where(Reading.metric == metric)
        readings = (
            await session.scalars(statement.order_by(Reading.observed_at.desc()).limit(limit))
        ).all()
        return ReadingListResponse(
            readings=[ReadingSummary.model_validate(reading) for reading in readings]
        )

    @application.post(
        "/api/v1/simulator/plants/{plant_id}/confirmed-watering",
        response_model=PlantSummary,
    )
    async def simulate_confirmed_watering(
        plant_id: str, identity: CurrentIdentity, session: Session
    ) -> PlantSummary:
        if not app_settings.simulator_enabled:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
        plant = await session.get(Plant, plant_id)
        if plant is None or not plant.active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plant not found")
        baseline = plant.moisture or 0
        plant.moisture = min(100, max(40, baseline + 12))
        plant.moisture_status = "normal"
        plant.state = "good"
        plant.last_reading_at = datetime.now(UTC)
        low_actions = (
            await session.scalars(
                select(CareAction)
                .where(CareAction.plant_id == plant.id)
                .where(CareAction.type == "low_moisture")
                .where(CareAction.status.in_(["open", "snoozed"]))
            )
        ).all()
        for action in low_actions:
            old_status = action.status
            action.status = ActionStatus.COMPLETED.value
            action.completed_at = datetime.now(UTC)
            action.completed_by = "Automatic moisture recovery"
            action.snoozed_until = None
            session.add(
                AuditEvent(
                    actor="Simulator",
                    event_type="action_auto_completed",
                    object_type="care_action",
                    object_id=action.id,
                    old_json={"status": old_status, "moisture": baseline},
                    new_json={"status": action.status, "moisture": plant.moisture},
                )
            )
        session.add(
            AuditEvent(
                actor=identity.actor,
                event_type="simulator_watering_confirmed",
                object_type="plant",
                object_id=plant.id,
                old_json={"moisture": baseline},
                new_json={"moisture": plant.moisture},
            )
        )
        await session.commit()
        await session.refresh(plant)
        return PlantSummary.model_validate(plant)

    @application.get("/api/v1/actions", response_model=ActionListResponse)
    async def list_actions(identity: CurrentIdentity, session: Session) -> ActionListResponse:
        del identity
        actions = (
            await session.scalars(
                select(CareAction)
                .join(Plant, Plant.id == CareAction.plant_id)
                .where(CareAction.status.in_(["open", "snoozed", "completed"]))
                .where(Plant.active.is_(True))
                .order_by(CareAction.status, CareAction.priority, CareAction.due_at)
            )
        ).all()
        return ActionListResponse(
            actions=[ActionSummary.model_validate(action) for action in actions]
        )

    @application.get("/api/v1/actions/history", response_model=ActionHistoryResponse)
    async def action_history(identity: CurrentIdentity, session: Session) -> ActionHistoryResponse:
        del identity
        events = (
            await session.scalars(
                select(AuditEvent)
                .where(AuditEvent.object_type == "care_action")
                .order_by(AuditEvent.occurred_at.desc())
                .limit(100)
            )
        ).all()
        return ActionHistoryResponse(
            events=[
                ActionHistoryItem(
                    id=event.id,
                    action_id=event.object_id or "",
                    actor=event.actor,
                    event_type=event.event_type,
                    old_json=event.old_json,
                    new_json=event.new_json,
                    occurred_at=event.occurred_at,
                )
                for event in events
            ]
        )

    async def action_or_404(action_id: str, session: AsyncSession) -> CareAction:
        action = await session.get(CareAction, action_id)
        if action is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Action not found")
        return action

    @application.post("/api/v1/actions/{action_id}/snooze", response_model=ActionSummary)
    async def snooze_action(
        action_id: str,
        payload: ActionSnoozeRequest,
        identity: CurrentIdentity,
        session: Session,
    ) -> ActionSummary:
        action = await action_or_404(action_id, session)
        old_status = action.status
        action.status = ActionStatus.SNOOZED.value
        action.snoozed_until = datetime.now(UTC) + timedelta(hours=payload.hours)
        action.completed_at = None
        action.completed_by = None
        session.add(
            AuditEvent(
                actor=identity.actor,
                event_type="action_snoozed",
                object_type="care_action",
                object_id=action.id,
                old_json={"status": old_status},
                new_json={
                    "status": action.status,
                    "snoozed_until": action.snoozed_until.isoformat(),
                },
            )
        )
        await session.commit()
        await session.refresh(action)
        return ActionSummary.model_validate(action)

    @application.post("/api/v1/actions/{action_id}/complete", response_model=ActionSummary)
    async def complete_action(
        action_id: str, identity: CurrentIdentity, session: Session
    ) -> ActionSummary:
        action = await action_or_404(action_id, session)
        if action.type in AUTO_MANAGED_ACTION_TYPES:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "This action is managed by sensor recovery and cannot be marked done "
                    "manually. Snooze it, or resolve the underlying sensor condition."
                ),
            )
        if action.status != ActionStatus.COMPLETED.value:
            old_status = action.status
            action.status = ActionStatus.COMPLETED.value
            action.completed_at = datetime.now(UTC)
            action.completed_by = identity.actor
            action.snoozed_until = None
            session.add(
                AuditEvent(
                    actor=identity.actor,
                    event_type="action_completed",
                    object_type="care_action",
                    object_id=action.id,
                    old_json={"status": old_status},
                    new_json={"status": action.status},
                )
            )
            plant = await session.get(Plant, action.plant_id)
            if plant and plant.state in {"action_needed", "overdue"}:
                active_count = await session.scalar(
                    select(func.count())
                    .select_from(CareAction)
                    .where(
                        CareAction.plant_id == action.plant_id,
                        CareAction.id != action.id,
                        CareAction.status.in_(
                            (ActionStatus.OPEN.value, ActionStatus.SNOOZED.value)
                        ),
                    )
                )
                if not active_count:
                    plant.state = "good"
            await session.commit()
            await session.refresh(action)
        return ActionSummary.model_validate(action)

    @application.post("/api/v1/actions/{action_id}/undo", response_model=ActionSummary)
    async def undo_action(
        action_id: str, identity: CurrentIdentity, session: Session
    ) -> ActionSummary:
        action = await action_or_404(action_id, session)
        old_status = action.status
        action.status = ActionStatus.OPEN.value
        action.completed_at = None
        action.completed_by = None
        action.snoozed_until = None
        plant = await session.get(Plant, action.plant_id)
        if plant and action.type not in AUTO_MANAGED_ACTION_TYPES:
            due_at = action.due_at
            if due_at and due_at.tzinfo is None:
                due_at = due_at.replace(tzinfo=UTC)
            plant.state = "overdue" if due_at and due_at < datetime.now(UTC) else "action_needed"
        session.add(
            AuditEvent(
                actor=identity.actor,
                event_type="action_reopened",
                object_type="care_action",
                object_id=action.id,
                old_json={"status": old_status},
                new_json={"status": action.status},
            )
        )
        await session.commit()
        await session.refresh(action)
        return ActionSummary.model_validate(action)

    static_dir = Path(app_settings.static_dir)
    assets_dir = static_dir / "assets"
    if assets_dir.is_dir():
        application.mount("/assets", StaticFiles(directory=assets_dir), name="assets")
    images_dir = static_dir / "images"
    if images_dir.is_dir():
        application.mount("/images", StaticFiles(directory=images_dir), name="images")

    @application.get("/{path:path}", include_in_schema=False)
    async def spa(path: str) -> FileResponse:
        if path.startswith("api/"):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
        index = static_dir / "index.html"
        if not index.is_file():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Frontend not built")
        return FileResponse(index)

    return application
