"""Provider selection and Gemini transport; credentials stay on the server."""

import asyncio
import base64
import json

import httpx2
from pydantic import ValidationError

from .config import Settings
from .plant_doctor import (
    DOCTOR_INSTRUCTIONS,
    CloudflarePlantDoctor,
    PlantDoctorContext,
    PlantDoctorProviderError,
    PlantDoctorSource,
    _assessment,
    _prompt,
    _response_format,
)
from .schemas import DoctorCarePlan, PlantDoctorResponse, PlantDoctorWateringGuidance

GEMINI = "Google Gemini"
CLOUDFLARE = "Cloudflare Workers AI"


async def bounded_assessment(
    source: PlantDoctorSource,
    photo: bytes,
    context: PlantDoctorContext,
    provider: str,
    seconds: float = 50,
) -> PlantDoctorResponse:
    # Keep a complete check (including fallback) below the ingress proxy timeout.
    try:
        async with asyncio.timeout(seconds):
            return await source.analyze(photo, context)
    except TimeoutError as exc:
        raise PlantDoctorProviderError("unavailable", provider) from exc


class GeminiPlantDoctor:
    def __init__(
        self,
        api_key: str,
        model: str,
        transport: httpx2.AsyncBaseTransport | None = None,
    ) -> None:
        self.api_key = api_key
        self.model = model
        self.transport = transport

    async def analyze(self, photo: bytes, context: PlantDoctorContext) -> PlantDoctorResponse:
        try:
            async with httpx2.AsyncClient(timeout=60, transport=self.transport) as client:
                response = await client.post(
                    f"https://generativelanguage.googleapis.com/v1beta/models/"
                    f"{self.model}:generateContent",
                    headers={"x-goog-api-key": self.api_key},
                    json={
                        "systemInstruction": {"parts": [{"text": DOCTOR_INSTRUCTIONS}]},
                        "contents": [
                            {
                                "role": "user",
                                "parts": [
                                    {"text": _prompt(context)},
                                    {
                                        "inlineData": {
                                            "mimeType": "image/jpeg",
                                            "data": base64.b64encode(photo).decode("ascii"),
                                        }
                                    },
                                ],
                            }
                        ],
                        "generationConfig": {
                            "responseMimeType": "application/json",
                            "responseJsonSchema": _response_format()["json_schema"],
                            "maxOutputTokens": 4096,
                        },
                    },
                )
        except (httpx2.TimeoutException, httpx2.NetworkError) as exc:
            raise PlantDoctorProviderError("unavailable", GEMINI) from exc
        if response.status_code in (401, 403):
            raise PlantDoctorProviderError("credentials", GEMINI)
        if response.status_code == 429:
            # Gemini can use 429 for minute or daily quotas; don't guess a reset time.
            raise PlantDoctorProviderError("rate_limit", GEMINI)
        if response.status_code in (400, 404):
            raise PlantDoctorProviderError("configuration", GEMINI)
        if not response.is_success:
            raise PlantDoctorProviderError("unavailable", GEMINI)
        try:
            payload = response.json()
            candidate = payload["candidates"][0]
            if candidate.get("finishReason") != "STOP":
                raise ValueError("Incomplete or blocked assessment")
            raw = "".join(
                part["text"]
                for part in candidate["content"]["parts"]
                if isinstance(part, dict)
                and isinstance(part.get("text"), str)
                and not part.get("thought")
            )
            parsed = json.loads(raw)
            _validate_assessment(parsed)
            assessment = _assessment(raw, None, context, provider=GEMINI, model=self.model)
            tokens = payload.get("usageMetadata", {}).get("totalTokenCount")
            if type(tokens) is not int or tokens < 0:
                tokens = None
            return assessment.model_copy(update={"total_tokens": tokens})
        except (ValueError, KeyError, IndexError, TypeError, AttributeError) as exc:
            raise PlantDoctorProviderError("invalid_response", GEMINI) from exc
        except PlantDoctorProviderError as exc:
            raise PlantDoctorProviderError(exc.kind, GEMINI) from exc


def _validate_assessment(value: object) -> None:
    """Reject broken model output instead of filling a diagnosis with defaults."""
    if not isinstance(value, dict):
        raise ValueError("Expected an assessment object")
    if value.get("identity_status") not in ("match", "mismatch", "uncertain"):
        raise ValueError("Missing identity assessment")
    if value.get("confidence") not in ("low", "medium", "high"):
        raise ValueError("Missing care confidence")
    for field in ("summary", "identity_explanation"):
        if not isinstance(value.get(field), str) or not value[field].strip():
            raise ValueError("Missing assessment text")
    for field in ("observations", "possible_issues", "next_steps"):
        items = value.get(field)
        if not isinstance(items, list) or not all(isinstance(item, str) for item in items):
            raise ValueError("Invalid assessment list")
    try:
        PlantDoctorWateringGuidance.model_validate(value.get("watering_guidance"), strict=True)
        if not isinstance(value.get("care_plan"), dict):
            raise ValueError("Missing care plan")
        if not {"urgency", "evidence", "avoid", "expected_improvement", "reassess"}.issubset(
            value["care_plan"]
        ):
            raise ValueError("Incomplete care plan")
        DoctorCarePlan.model_validate(value["care_plan"], strict=True)
    except ValidationError as exc:
        raise ValueError("Invalid care plan") from exc


class FallbackPlantDoctor:
    def __init__(self, primary: PlantDoctorSource, fallback: PlantDoctorSource) -> None:
        self.primary = primary
        self.fallback = fallback

    async def analyze(self, photo: bytes, context: PlantDoctorContext) -> PlantDoctorResponse:
        try:
            return await bounded_assessment(self.primary, photo, context, GEMINI, 20)
        except PlantDoctorProviderError as exc:
            # A diagnosis expressing uncertainty is a valid answer, not a fallback trigger.
            if exc.kind not in {
                "unavailable",
                "capacity",
                "rate_limit",
                "quota",
                "invalid_response",
            }:
                raise
        result = await bounded_assessment(self.fallback, photo, context, CLOUDFLARE, 25)
        return result.model_copy(update={"fallback_used": True})


def configured_doctor(settings: Settings) -> tuple[PlantDoctorSource | None, str, bool]:
    key = settings.gemini_api_key.get_secret_value().strip() if settings.gemini_api_key else ""
    token = (
        settings.cloudflare_api_token.get_secret_value().strip()
        if settings.cloudflare_api_token
        else ""
    )
    cloudflare = (
        CloudflarePlantDoctor(settings.cloudflare_account_id, token)
        if settings.cloudflare_account_id and token
        else None
    )
    use_gemini = settings.doctor_provider == "gemini" or (
        settings.doctor_provider == "auto" and bool(key)
    )
    if not use_gemini:
        return cloudflare, CLOUDFLARE, False
    if not key:
        return None, GEMINI, False
    gemini = GeminiPlantDoctor(key, settings.gemini_model)
    if settings.doctor_cloudflare_fallback and cloudflare:
        return FallbackPlantDoctor(gemini, cloudflare), GEMINI, True
    return gemini, GEMINI, False
