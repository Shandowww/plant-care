import base64
import json
from dataclasses import dataclass
from typing import Any, Literal, Protocol

import httpx2

from .schemas import PlantDoctorResponse

MODEL_ID = "@cf/meta/llama-3.2-11b-vision-instruct"
PROVIDER_NAME = "Cloudflare Workers AI"
DISCLAIMER = (
    "AI visual guidance can be wrong. Confirm suggestions against the plant, its sensors, "
    "and trusted horticultural advice before changing care."
)


@dataclass(frozen=True)
class PlantDoctorContext:
    display_name: str
    common_name: str
    scientific_name: str | None
    location: str
    environment_type: str
    moisture: float | None
    temperature: float | None
    illuminance: float | None


class PlantDoctorSource(Protocol):
    async def analyze(self, photo: bytes, context: PlantDoctorContext) -> PlantDoctorResponse: ...


class PlantDoctorProviderError(RuntimeError):
    def __init__(self, kind: Literal["credentials", "quota", "unavailable"]) -> None:
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
                                    "You provide cautious visual guidance for household plants. "
                                    "Do not claim certainty, prescribe pesticides, or treat sensor "
                                    "values as visual facts. Return only one JSON object with keys "
                                    "summary, observations, possible_issues, next_steps, "
                                    "confidence. The three list fields must contain at most "
                                    "three short strings. "
                                    "Confidence must be low, medium, or high."
                                ),
                            },
                            {"role": "user", "content": _prompt(context)},
                        ],
                        "image": f"data:image/jpeg;base64,{image}",
                        "max_tokens": 420,
                        "temperature": 0.2,
                    },
                )
        except (httpx2.TimeoutException, httpx2.NetworkError) as exc:
            raise PlantDoctorProviderError("unavailable") from exc

        if response.status_code in {401, 403}:
            raise PlantDoctorProviderError("credentials")
        if response.status_code == 429:
            raise PlantDoctorProviderError("quota")
        try:
            payload = response.json()
        except ValueError as exc:
            raise PlantDoctorProviderError("unavailable") from exc
        if not response.is_success or not isinstance(payload, dict) or not payload.get("success"):
            if _has_error_code(payload, 3036):
                raise PlantDoctorProviderError("quota")
            if _has_error_code(payload, 10000) or _has_error_code(payload, 9109):
                raise PlantDoctorProviderError("credentials")
            raise PlantDoctorProviderError("unavailable")

        result = payload.get("result")
        if not isinstance(result, dict) or not isinstance(result.get("response"), str):
            raise PlantDoctorProviderError("unavailable")
        neurons = None
        usage = result.get("usage")
        if isinstance(usage, dict) and isinstance(usage.get("neurons"), int | float):
            neurons = float(usage["neurons"])
        return _assessment(result["response"], neurons)


def _prompt(context: PlantDoctorContext) -> str:
    sensor_context = {
        "moisture_percent": context.moisture,
        "temperature_celsius": context.temperature,
        "illuminance_lux": context.illuminance,
    }
    return (
        "Review the attached current photo of this plant for visible stress, damage, pests, "
        "or care concerns. Distinguish direct observations from possibilities and suggest safe "
        "physical checks before care changes.\n"
        f"Plant: {context.display_name}; common name: {context.common_name}; "
        f"scientific name: {context.scientific_name or 'unknown'}; location: {context.location}; "
        f"exposure: {context.environment_type}.\n"
        f"Latest optional sensor context: {json.dumps(sensor_context, separators=(',', ':'))}."
    )


def _has_error_code(payload: Any, code: int) -> bool:
    if not isinstance(payload, dict) or not isinstance(payload.get("errors"), list):
        return False
    return any(isinstance(error, dict) and error.get("code") == code for error in payload["errors"])


def _assessment(raw_response: str, neurons: float | None) -> PlantDoctorResponse:
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
        return PlantDoctorResponse(
            summary=text[:1200] or "The provider did not return an assessment.",
            observations=[],
            possible_issues=[],
            next_steps=["Inspect the plant directly before changing its care."],
            confidence="low",
            provider=PROVIDER_NAME,
            model=MODEL_ID,
            neurons=neurons,
            disclaimer=DISCLAIMER,
        )
    confidence = parsed.get("confidence")
    if confidence not in {"low", "medium", "high"}:
        confidence = "low"
    return PlantDoctorResponse(
        summary=_clean_text(parsed.get("summary"), "Visual assessment completed."),
        observations=_clean_list(parsed.get("observations")),
        possible_issues=_clean_list(parsed.get("possible_issues")),
        next_steps=_clean_list(parsed.get("next_steps")),
        confidence=confidence,
        provider=PROVIDER_NAME,
        model=MODEL_ID,
        neurons=neurons,
        disclaimer=DISCLAIMER,
    )


def _clean_text(value: Any, fallback: str) -> str:
    return value.strip()[:1200] if isinstance(value, str) and value.strip() else fallback


def _clean_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip()[:300] for item in value if isinstance(item, str) and item.strip()][:3]
