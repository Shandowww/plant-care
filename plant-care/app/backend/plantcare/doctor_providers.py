"""Provider selection and Gemini transport; credentials stay on the server."""

import asyncio
import base64
import json
from time import monotonic

import httpx2
import structlog
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
from .schemas import (
    DoctorCarePlan,
    DoctorVerification,
    PlantDoctorResponse,
    PlantDoctorWateringGuidance,
)

GEMINI = "Google Gemini"
CLOUDFLARE = "Cloudflare Workers AI"
logger = structlog.get_logger()


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
        raise PlantDoctorProviderError("timeout", provider) from exc


def _check_gemini_status(response: httpx2.Response) -> None:
    # Google sometimes reports invalid/expired keys as HTTP 400. Inspect only
    # allowlisted machine reasons, never return/log its message or payload.
    reasons: set[str] = set()
    try:
        payload = response.json()
        details = payload.get("error", {}).get("details", [])
        reasons = {
            item["reason"]
            for item in details
            if isinstance(item, dict) and isinstance(item.get("reason"), str)
        }
    except (ValueError, TypeError, AttributeError):
        pass
    if response.status_code in (401, 403) or reasons.intersection(
        {
            "API_KEY_INVALID",
            "API_KEY_EXPIRED",
            "API_KEY_SERVICE_BLOCKED",
            "API_KEY_HTTP_REFERRER_BLOCKED",
            "API_KEY_IP_ADDRESS_BLOCKED",
        }
    ):
        raise PlantDoctorProviderError("credentials", GEMINI)
    if response.status_code == 429:
        raise PlantDoctorProviderError("rate_limit", GEMINI)
    if response.status_code == 503:
        raise PlantDoctorProviderError("capacity", GEMINI)
    if response.status_code in (400, 404):
        raise PlantDoctorProviderError("configuration", GEMINI)
    if not response.is_success:
        raise PlantDoctorProviderError("unavailable", GEMINI)


async def verify_gemini(
    settings: Settings,
    transport: httpx2.AsyncBaseTransport | None = None,
) -> DoctorVerification:
    key = settings.gemini_api_key.get_secret_value().strip() if settings.gemini_api_key else ""

    def result(ok: bool, reason: str, message: str) -> DoctorVerification:
        return DoctorVerification(
            ok=ok, reason=reason, message=message, model=settings.gemini_model
        )

    if not key:
        return result(
            False,
            "not_configured",
            "No Gemini key is loaded. Save gemini_api_key in the Home Assistant "
            "add-on configuration and restart PlantCare.",
        )
    try:
        async with asyncio.timeout(12):
            async with httpx2.AsyncClient(timeout=10, transport=transport) as client:
                response = await client.get(
                    f"https://generativelanguage.googleapis.com/v1beta/models/{settings.gemini_model}",
                    headers={"x-goog-api-key": key},
                )
        _check_gemini_status(response)
        payload = response.json()
        if not isinstance(payload, dict) or not isinstance(payload.get("name"), str):
            raise PlantDoctorProviderError("invalid_response", GEMINI)
        methods = payload.get("supportedGenerationMethods")
        if not isinstance(methods, list) or "generateContent" not in methods:
            raise PlantDoctorProviderError("configuration", GEMINI)
    except (httpx2.TimeoutException, TimeoutError):
        return result(
            False,
            "timeout",
            "Gemini verification timed out. Check the Pi's internet connection and retry; "
            "this does not prove the key is invalid.",
        )
    except httpx2.NetworkError:
        return result(
            False,
            "network",
            "Could not connect to Google. Check the Pi's internet connection, DNS and firewall.",
        )
    except ValueError:
        return result(
            False, "invalid_response", "Google returned an unexpected response. Retry shortly."
        )
    except PlantDoctorProviderError as exc:
        messages = {
            "credentials": "Google rejected the key or its permissions. Use a current "
            "Google AI Studio auth key, check its API restrictions, save it in Home "
            "Assistant and restart PlantCare.",
            "configuration": "The configured Gemini model is unavailable or unsupported "
            "for this key. Check gemini_model and your Google AI Studio account access.",
            "rate_limit": "Google reported a rate or quota limit. Check Google AI Studio "
            "for the limit and reset time.",
            "unavailable": "Google's API returned a service error. Retry shortly; "
            "the key has not been verified.",
            "capacity": "Google returned HTTP 503: its service is temporarily unavailable "
            "or overloaded. Retry later; this does not indicate an invalid key.",
            "invalid_response": "Google returned unexpected model information. Retry shortly.",
        }
        return result(False, exc.kind, messages.get(exc.kind, "Gemini verification failed."))
    return result(
        True,
        "verified",
        "Google accepted the key and returned a model supporting generateContent. "
        "No photo or plant data was sent and no assessment was generated. "
        "This does not verify generation quota, image diagnosis, or response quality.",
    )


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

    async def _send(
        self, client: httpx2.AsyncClient, request: httpx2.Request, attempt: int
    ) -> httpx2.Response:
        started = monotonic()
        status_code: int | None = None
        outcome = "cancelled"
        try:
            response = await client.send(request)
            status_code = response.status_code
            outcome = "response"
            return response
        except httpx2.TimeoutException:
            outcome = "transport_timeout"
            raise
        except httpx2.NetworkError:
            outcome = "network_error"
            raise
        finally:
            # Do not include headers, URL, photo, prompt, or provider payload.
            logger.info(
                "plant_doctor_gemini_attempt",
                model=self.model,
                attempt=attempt,
                outcome=outcome,
                status_code=status_code,
                elapsed_seconds=round(monotonic() - started, 2),
            )

    async def analyze(self, photo: bytes, context: PlantDoctorContext) -> PlantDoctorResponse:
        try:
            async with httpx2.AsyncClient(timeout=60, transport=self.transport) as client:
                request = client.build_request(
                    "POST",
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
                            # Explicitly lower latency for the supported default
                            # model; do not send incompatible options to overrides.
                            **(
                                {"thinkingConfig": {"thinkingLevel": "low"}}
                                if self.model == "gemini-3.6-flash"
                                else {}
                            ),
                        },
                    },
                )
                # Retry only an explicit temporary rejection, never an ambiguous
                # network timeout or a completed but malformed assessment. The
                # caller's overall deadline includes both attempts and backoff.
                response = await self._send(client, request, 1)
                if response.status_code == 503:
                    await asyncio.sleep(1)
                    response = await self._send(client, request, 2)
        except httpx2.TimeoutException as exc:
            raise PlantDoctorProviderError("timeout", GEMINI) from exc
        except httpx2.NetworkError as exc:
            raise PlantDoctorProviderError("unavailable", GEMINI) from exc
        _check_gemini_status(response)
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
                "timeout",
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
