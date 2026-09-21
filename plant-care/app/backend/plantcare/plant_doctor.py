import base64
import json
import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal, Protocol

import httpx2

from .care_profiles import watering_instructions
from .schemas import PlantDoctorResponse, PlantDoctorWateringGuidance

MODEL_ID = "@cf/meta/llama-3.2-11b-vision-instruct"
NORMALIZER_MODEL_ID = "@cf/meta/llama-3.1-8b-instruct"
PROVIDER_NAME = "Cloudflare Workers AI"
DISCLAIMER = (
    "AI visual guidance can be wrong. Confirm suggestions against the plant, its sensors, "
    "and trusted horticultural advice before changing care."
)


@dataclass(frozen=True)
class PlantDoctorHistoryContext:
    checked_at: str
    summary: str
    recommendation: str
    decision: str
    outcome: str
    watering_summary: str | None = None


@dataclass(frozen=True)
class MoistureHistoryPoint:
    observed_at: datetime
    value: float


@dataclass(frozen=True)
class MoistureHistoryContext:
    window_hours: int
    readings_count: int
    oldest_percent: float | None
    latest_percent: float | None
    minimum_percent: float | None
    maximum_percent: float | None
    trend: Literal["rising", "falling", "stable", "insufficient"]
    current_high_streak_hours_at_least: float | None
    current_low_streak_hours_at_least: float | None


@dataclass(frozen=True)
class PlantDoctorContext:
    display_name: str
    common_name: str
    scientific_name: str | None
    location: str
    specific_position: str | None
    environment_type: str
    moisture: float | None
    temperature: float | None
    illuminance: float | None
    temperature_range_celsius: tuple[int, int]
    moisture_monitoring_thresholds_percent: tuple[float, float]
    care_profile_basis: str
    moisture_history: MoistureHistoryContext
    history: tuple[PlantDoctorHistoryContext, ...] = ()


class PlantDoctorSource(Protocol):
    async def analyze(self, photo: bytes, context: PlantDoctorContext) -> PlantDoctorResponse: ...


class PlantDoctorProviderError(RuntimeError):
    def __init__(
        self,
        kind: Literal[
            "credentials",
            "quota",
            "capacity",
            "rate_limit",
            "configuration",
            "invalid_response",
            "unavailable",
        ],
    ) -> None:
        super().__init__(kind)
        self.kind = kind


class CloudflarePlantDoctor:
    def __init__(
        self,
        account_id: str,
        api_token: str,
        transport: httpx2.AsyncBaseTransport | None = None,
    ) -> None:
        self.account_id = account_id.strip()
        self.api_token = api_token
        self.transport = transport

    async def analyze(self, photo: bytes, context: PlantDoctorContext) -> PlantDoctorResponse:
        image = base64.b64encode(photo).decode("ascii")
        url = f"https://api.cloudflare.com/client/v4/accounts/{self.account_id}/ai/run/{MODEL_ID}"
        try:
            async with httpx2.AsyncClient(timeout=45.0, transport=self.transport) as client:
                response = await client.post(
                    url,
                    headers={"Authorization": f"Bearer {self.api_token}"},
                    json={
                        "messages": [
                            {
                                "role": "system",
                                "content": (
                                    "You provide cautious, species-aware visual guidance for "
                                    "household plants. FIRST compare leaf shape, growth habit "
                                    "and flowers against the claimed identity. The supplied name "
                                    "is an unverified claim, not proof of what the photo shows. "
                                    "Return identity_status: match, mismatch, or uncertain, and "
                                    "identity_explanation with visible evidence. Use match only "
                                    "with supporting visual evidence; uncertain when insufficient. "
                                    "On mismatch or uncertainty, withhold species-specific care, "
                                    "watering instructions and sensor interpretation. Never change "
                                    "the saved identity. Name the plant only when supported; make "
                                    "advice specific to that taxon when possible. "
                                    "Do not claim certainty, prescribe pesticides, or treat sensor "
                                    "values as visual facts. Return JSON only. Do not include "
                                    "Markdown, code fences, or an introduction. It must have keys "
                                    "identity_status, identity_explanation, summary, observations, "
                                    "possible_issues, next_steps, "
                                    "watering_guidance, confidence. watering_guidance must be "
                                    "an object with assessment and notification_point strings, "
                                    "plus manual_checks, watering_steps, and drying_steps arrays. "
                                    "Each list field must contain at most three short strings. "
                                    "Confidence must be low, medium, or high. Use plain text, "
                                    "no Markdown or section headings. Keep summary under 40 words."
                                ),
                            },
                            {"role": "user", "content": _prompt(context)},
                        ],
                        "image": f"data:image/jpeg;base64,{image}",
                        "max_tokens": 1100,
                        "temperature": 0.2,
                    },
                )
        except (httpx2.TimeoutException, httpx2.NetworkError) as exc:
            raise PlantDoctorProviderError("unavailable") from exc

        raw_response, neurons = _provider_result(response)
        try:
            return _assessment(raw_response, neurons, context)
        except PlantDoctorProviderError as exc:
            if exc.kind != "invalid_response":
                raise
        normalized, normalizer_neurons = await self._normalize(raw_response)
        total_neurons = sum(value for value in (neurons, normalizer_neurons) if value is not None)
        return _assessment(normalized, total_neurons or None, context)

    async def _normalize(self, raw_response: str) -> tuple[str, float | None]:
        url = (
            f"https://api.cloudflare.com/client/v4/accounts/{self.account_id}/ai/run/"
            f"{NORMALIZER_MODEL_ID}"
        )
        try:
            async with httpx2.AsyncClient(timeout=30.0, transport=self.transport) as client:
                response = await client.post(
                    url,
                    headers={"Authorization": f"Bearer {self.api_token}"},
                    json={
                        "messages": [
                            {
                                "role": "system",
                                "content": (
                                    "Convert the vision assessment to the requested JSON schema. "
                                    "Preserve its claims and uncertainty; do not add a diagnosis. "
                                    "Use identity_status=match only when the source says "
                                    "visible evidence supports the supplied identity. Use mismatch "
                                    "only for a clear conflict; otherwise uncertain. On mismatch "
                                    "or uncertainty, leave possible_issues, next_steps, and all "
                                    "watering_guidance list empty."
                                ),
                            },
                            {"role": "user", "content": raw_response[:8_000]},
                        ],
                        "response_format": _response_format(),
                        "max_tokens": 900,
                        "temperature": 0,
                    },
                )
        except (httpx2.TimeoutException, httpx2.NetworkError) as exc:
            raise PlantDoctorProviderError("unavailable") from exc
        return _provider_result(response)


def _response_format() -> dict[str, Any]:
    short_text = {"type": "string", "maxLength": 300}
    short_list = {"type": "array", "items": short_text, "maxItems": 3}
    return {
        "type": "json_schema",
        "json_schema": {
            "type": "object",
            "properties": {
                "identity_status": {
                    "type": "string",
                    "enum": ["match", "mismatch", "uncertain"],
                },
                "identity_explanation": short_text,
                "summary": short_text,
                "observations": short_list,
                "possible_issues": short_list,
                "next_steps": short_list,
                "watering_guidance": {
                    "type": "object",
                    "properties": {
                        "assessment": short_text,
                        "notification_point": short_text,
                        "manual_checks": short_list,
                        "watering_steps": short_list,
                        "drying_steps": short_list,
                    },
                    "required": [
                        "assessment",
                        "notification_point",
                        "manual_checks",
                        "watering_steps",
                        "drying_steps",
                    ],
                },
                "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
            },
            "required": [
                "identity_status",
                "identity_explanation",
                "summary",
                "observations",
                "possible_issues",
                "next_steps",
                "watering_guidance",
                "confidence",
            ],
        },
    }


def _prompt(context: PlantDoctorContext) -> str:
    sensor_context = {
        "moisture_percent": context.moisture,
        "temperature_celsius": context.temperature,
        "illuminance_lux": context.illuminance,
    }
    care_profile = {
        "temperature_range_celsius": context.temperature_range_celsius,
        "moisture_monitoring_thresholds_percent": {
            "watering_check_at_or_below": context.moisture_monitoring_thresholds_percent[0],
            "prolonged_wet_at_or_above": context.moisture_monitoring_thresholds_percent[1],
        },
        "basis": context.care_profile_basis,
    }
    moisture_history = {
        "window_hours": context.moisture_history.window_hours,
        "readings_count": context.moisture_history.readings_count,
        "oldest_percent": context.moisture_history.oldest_percent,
        "latest_percent": context.moisture_history.latest_percent,
        "minimum_percent": context.moisture_history.minimum_percent,
        "maximum_percent": context.moisture_history.maximum_percent,
        "trend": context.moisture_history.trend,
        "current_high_streak_hours_at_least": (
            context.moisture_history.current_high_streak_hours_at_least
        ),
        "current_low_streak_hours_at_least": (
            context.moisture_history.current_low_streak_hours_at_least
        ),
    }
    history_context = [
        {
            "checked_at": item.checked_at,
            "summary": item.summary,
            "recommendation": item.recommendation,
            "decision": item.decision,
            "outcome": item.outcome,
            "watering_summary": item.watering_summary,
        }
        for item in context.history
    ]
    history_instruction = (
        "No previous Plant Doctor assessments are available."
        if not history_context
        else (
            "Recent local assessment history is included below. Assess the current photo "
            "independently. Avoid repeating advice marked did_not_help unless current evidence "
            "supports retrying it, and explain why if you do.\n"
            f"Recent history: {json.dumps(history_context, separators=(',', ':'))}."
        )
    )
    return (
        f"Review the attached current photo of {context.display_name} for visible stress, damage, "
        "pests, or care concerns. Distinguish direct observations from possibilities and suggest "
        "an evidence-based care plan only after verifying the photo identity. If the photo "
        "does not appear consistent with the supplied identity, say so rather than silently "
        "switching to generic advice.\n"
        f"Unverified record identity — friendly name: {context.display_name}; common name: "
        f"{context.common_name}; scientific name: {context.scientific_name or 'unknown'}; "
        f"Home Assistant area: {context.location}; precise position: "
        f"{context.specific_position or 'not provided'}; "
        f"exposure: {context.environment_type}.\n"
        f"Latest optional sensor context: {json.dumps(sensor_context, separators=(',', ':'))}.\n"
        f"Care profile: {json.dumps(care_profile, separators=(',', ':'))}. Compare available "
        "temperature and soil-moisture readings with this profile when relevant. Treat the soil "
        "moisture thresholds as provisional monitoring triggers because calibration, substrate, "
        "and probe placement vary; they are not a universal healthy range.\n"
        f"Recent soil-moisture history summary: "
        f"{json.dumps(moisture_history, separators=(',', ':'))}. Do not claim the soil has "
        "stayed wet or dry longer than this history supports. Streak durations labelled "
        "at_least are lower bounds, not exact onset times. If the sample count is low, state "
        "that the evidence is insufficient.\n"
        "Build watering_guidance specifically for this plant and its current evidence. In "
        "notification_point, use the supplied watering-check trigger as a provisional "
        "alert point and explain that the user should calibrate it against this pot rather than "
        "presenting it as a universal threshold. Lead with actionable, species-specific watering "
        "technique when watering is due, not routine reminders to inspect the soil. Leave "
        "manual_checks empty unless conflicting readings or symptoms warrant a targeted "
        "diagnostic check; do not recommend watering when evidence suggests excess moisture. "
        "In watering_steps, explain an appropriate slow, even watering method, "
        "drainage, and saucer handling; do not invent a fixed water volume when pot dimensions "
        "are unknown. Only recommend drying interventions when the current reading or history "
        "supports excess moisture. Prefer safe drainage, airflow, and species-suitable light or "
        "temperature changes; do not prescribe direct heat, harsh sun, or repotting without "
        "specific evidence. Remember that this percentage is soil moisture, not air humidity.\n"
        f"{history_instruction}"
    )


def summarize_moisture_history(
    points: list[MoistureHistoryPoint],
    *,
    now: datetime,
    lower_percent: float,
    upper_percent: float,
    window_hours: int = 168,
) -> MoistureHistoryContext:
    """Reduce recent readings to a small, bounded context suitable for an AI prompt."""
    ordered = sorted(points, key=lambda point: _as_utc(point.observed_at))
    if not ordered:
        return MoistureHistoryContext(
            window_hours=window_hours,
            readings_count=0,
            oldest_percent=None,
            latest_percent=None,
            minimum_percent=None,
            maximum_percent=None,
            trend="insufficient",
            current_high_streak_hours_at_least=None,
            current_low_streak_hours_at_least=None,
        )
    values = [point.value for point in ordered]
    trend: Literal["rising", "falling", "stable", "insufficient"] = "insufficient"
    if len(ordered) >= 2:
        change = values[-1] - values[0]
        trend = "stable" if abs(change) < 2 else "rising" if change > 0 else "falling"

    high_hours = _current_streak_hours(ordered, now, lambda value: value > upper_percent)
    low_hours = _current_streak_hours(ordered, now, lambda value: value < lower_percent)
    return MoistureHistoryContext(
        window_hours=window_hours,
        readings_count=len(ordered),
        oldest_percent=round(values[0], 1),
        latest_percent=round(values[-1], 1),
        minimum_percent=round(min(values), 1),
        maximum_percent=round(max(values), 1),
        trend=trend,
        current_high_streak_hours_at_least=high_hours,
        current_low_streak_hours_at_least=low_hours,
    )


def _current_streak_hours(
    points: list[MoistureHistoryPoint],
    now: datetime,
    predicate: Callable[[float], bool],
) -> float | None:
    if not predicate(points[-1].value):
        return None
    started_at = points[-1].observed_at
    for point in reversed(points[:-1]):
        if not predicate(point.value):
            break
        started_at = point.observed_at
    hours = max((_as_utc(now) - _as_utc(started_at)).total_seconds() / 3600, 0)
    return round(hours, 1)


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _has_error_code(payload: Any, code: int) -> bool:
    if not isinstance(payload, dict) or not isinstance(payload.get("errors"), list):
        return False
    return any(isinstance(error, dict) and error.get("code") == code for error in payload["errors"])


def _has_error_message(payload: Any, needle: str) -> bool:
    if not isinstance(payload, dict) or not isinstance(payload.get("errors"), list):
        return False
    return any(
        isinstance(error, dict) and needle.casefold() in str(error.get("message", "")).casefold()
        for error in payload["errors"]
    )


def _provider_result(response: httpx2.Response) -> tuple[str, float | None]:
    try:
        payload = response.json()
    except ValueError as exc:
        if response.status_code in {401, 403}:
            raise PlantDoctorProviderError("credentials") from exc
        if response.status_code == 429:
            raise PlantDoctorProviderError("rate_limit") from exc
        raise PlantDoctorProviderError(
            "invalid_response" if response.is_success else "unavailable"
        ) from exc
    if not response.is_success or not isinstance(payload, dict) or not payload.get("success"):
        if _has_error_code(payload, 3036):
            raise PlantDoctorProviderError("quota")
        if _has_error_code(payload, 3040):
            raise PlantDoctorProviderError("capacity")
        if any(_has_error_code(payload, code) for code in (3023, 5016, 5018, 5035, 3041)):
            raise PlantDoctorProviderError("configuration")
        if _has_error_code(payload, 10000) or _has_error_code(payload, 9109):
            raise PlantDoctorProviderError("credentials")
        if response.status_code in {401, 403}:
            raise PlantDoctorProviderError("credentials")
        if response.status_code == 429:
            raise PlantDoctorProviderError("rate_limit")
        if _has_error_message(payload, "json mode"):
            raise PlantDoctorProviderError("invalid_response")
        raise PlantDoctorProviderError("unavailable")

    result = payload.get("result")
    if not isinstance(result, dict):
        raise PlantDoctorProviderError("invalid_response")
    response_value = result.get("response")
    if isinstance(response_value, dict):
        raw_response = json.dumps(response_value)
    elif isinstance(response_value, str):
        raw_response = response_value
    else:
        raise PlantDoctorProviderError("invalid_response")
    neurons = None
    usage = result.get("usage")
    if isinstance(usage, dict) and isinstance(usage.get("neurons"), int | float):
        neurons = float(usage["neurons"])
    return raw_response, neurons


def _assessment(
    raw_response: str, neurons: float | None, context: PlantDoctorContext
) -> PlantDoctorResponse:
    text = raw_response.strip()
    if text.startswith("```"):
        text = text.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    start = text.find("{")
    end = text.rfind("}")
    parsed: Any = None
    if start >= 0 and end > start:
        try:
            parsed = json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            parsed = None
    if not isinstance(parsed, dict):
        raise PlantDoctorProviderError("invalid_response")
    identity_status = parsed.get("identity_status")
    if identity_status not in ("match", "mismatch", "uncertain"):
        identity_status = "uncertain"
    if identity_status != "match":
        return PlantDoctorResponse(
            identity_status="mismatch" if identity_status == "mismatch" else "uncertain",
            identity_explanation=_clean_text(
                parsed.get("identity_explanation"),
                "The photo could not be confidently matched to the selected plant.",
            ),
            summary="Photo identity needs confirmation before a care plan can be provided.",
            observations=_clean_list(parsed.get("observations")),
            possible_issues=[],
            next_steps=[],
            watering_guidance=PlantDoctorWateringGuidance(
                assessment="Species-specific watering advice is withheld for this photo.",
                notification_point="Existing sensor settings have not been changed.",
                manual_checks=[],
                watering_steps=[],
                drying_steps=[],
            ),
            confidence="low",
            provider=PROVIDER_NAME,
            model=MODEL_ID,
            neurons=neurons,
            disclaimer=DISCLAIMER,
        )
    raw_confidence = parsed.get("confidence")
    confidence: Literal["low", "medium", "high"] = "low"
    if raw_confidence == "medium":
        confidence = "medium"
    elif raw_confidence == "high":
        confidence = "high"
    return PlantDoctorResponse(
        identity_status="match",
        identity_explanation=_clean_text(parsed.get("identity_explanation"), ""),
        summary=_clean_text(parsed.get("summary"), "Visual assessment completed."),
        observations=_clean_list(parsed.get("observations")),
        possible_issues=_clean_list(parsed.get("possible_issues")),
        next_steps=_clean_list(parsed.get("next_steps")),
        watering_guidance=_clean_watering_guidance(parsed.get("watering_guidance"), context),
        confidence=confidence,
        provider=PROVIDER_NAME,
        model=MODEL_ID,
        neurons=neurons,
        disclaimer=DISCLAIMER,
    )


def _clean_text(value: Any, fallback: str) -> str:
    if not isinstance(value, str) or not value.strip():
        return fallback
    return re.sub(r"[*`#]+", "", value).strip()[:1200]


def _clean_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [
        _clean_text(item, "")[:300] for item in value if isinstance(item, str) and item.strip()
    ][:3]


def _clean_watering_guidance(
    value: Any, context: PlantDoctorContext
) -> PlantDoctorWateringGuidance:
    fallback = _fallback_watering_guidance(context)
    if not isinstance(value, dict):
        return fallback
    return PlantDoctorWateringGuidance(
        assessment=_clean_text(value.get("assessment"), fallback.assessment),
        notification_point=_clean_text(
            value.get("notification_point"), fallback.notification_point
        ),
        manual_checks=_clean_list(value.get("manual_checks")) or fallback.manual_checks,
        watering_steps=_clean_list(value.get("watering_steps")) or fallback.watering_steps,
        drying_steps=_clean_list(value.get("drying_steps")),
    )


def _fallback_watering_guidance(context: PlantDoctorContext) -> PlantDoctorWateringGuidance:
    lower = context.moisture_monitoring_thresholds_percent[0]
    return PlantDoctorWateringGuidance(
        assessment="When watering is due, use the technique below; this is not a diagnosis.",
        notification_point=(
            f"Start with an alert at or below {lower:g}% and calibrate it against this "
            "pot's actual root-zone moisture before treating it as the watering threshold."
        ),
        manual_checks=[],
        watering_steps=[watering_instructions(context.scientific_name, context.common_name)],
        drying_steps=[],
    )
