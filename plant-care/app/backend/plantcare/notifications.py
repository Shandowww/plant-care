"""Persist notification routing and acknowledge each recipient independently."""

from dataclasses import asdict, replace
from urllib.parse import quote

from sqlalchemy.ext.asyncio import AsyncSession

from .home_assistant import HomeAssistantNotificationSink
from .models import AppSetting
from .schemas import NotificationPreferences
from .sync import NotificationEvent

PREFERENCES_KEY = "notification.preferences"


async def preferences(session: AsyncSession) -> NotificationPreferences:
    saved = await session.get(AppSetting, PREFERENCES_KEY)
    return NotificationPreferences.model_validate(saved.typed_value if saved else {})


async def deliver(
    session: AsyncSession, pending: AppSetting, sink: HomeAssistantNotificationSink
) -> None:
    event = NotificationEvent(**pending.typed_value)
    # Remember original recipients so recovery clears their notifications even
    # if household settings changed in the meantime. Existing alerts predate
    # routing and therefore belong to the persistent notification panel.
    route_key = f"notification.recipients.{event.notification_id}"
    route = await session.get(AppSetting, route_key)
    if route is None:
        prefs = await preferences(session)
        targets = (
            ["persistent"]
            if event.operation == "dismiss"
            else (["persistent"] if prefs.persistent else []) + prefs.devices
        )
        route = AppSetting(key=route_key, typed_value=targets)
        session.add(route)
        await session.commit()
    failure: Exception | None = None
    for target in route.typed_value:
        if target in event.delivered_to:
            continue
        try:
            if event.operation == "dismiss":
                if target == "persistent":
                    await sink.dismiss_persistent_notification(
                        notification_id=event.notification_id
                    )
                else:
                    await sink.notify_device(
                        target,
                        {"message": "clear_notification", "data": {"tag": event.notification_id}},
                    )
            else:
                url = f"{await sink.ingress_url()}#plants/{quote(event.plant_id, safe='')}"
                title = event.title or "PlantCare care reminder"
                if target == "persistent":
                    await sink.create_persistent_notification(
                        notification_id=event.notification_id,
                        title=title,
                        message=f"{event.message}\n\n[Open this plant in PlantCare]({url})",
                    )
                else:
                    await sink.notify_device(
                        target,
                        {
                            "title": title,
                            "message": event.message or title,
                            "data": {
                                "tag": event.notification_id,
                                "url": url,
                                "clickAction": url,
                                "alert_once": True,
                            },
                        },
                    )
            event = replace(event, delivered_to=[*event.delivered_to, target])
            pending.typed_value = asdict(event)
            await session.commit()
        except Exception as exc:
            failure = exc
    if failure is not None:
        raise failure
    await session.delete(pending)
    if event.operation == "dismiss":
        await session.delete(route)
    await session.commit()
