import type { ActionHistoryResponse, ActionResponse, CareAction, HealthResponse, HomeAssistantEntityResponse, Plant, PlantCreate, PlantEntityMapping, PlantResponse } from "./types";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function ingressRelative(path: string): string {
  return path.replace(/^\/+/, "");
}

export async function getPlants(signal?: AbortSignal): Promise<PlantResponse> {
  const response = await fetch(ingressRelative("/api/v1/plants"), {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) {
    throw new ApiError(response.status, "The plant data could not be loaded.");
  }
  return (await response.json()) as PlantResponse;
}

export async function login(password: string): Promise<void> {
  const response = await fetch(ingressRelative("/api/v1/auth/login"), {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!response.ok) {
    const message = response.status === 429
      ? "Too many attempts. Please wait a moment."
      : "That password was not accepted.";
    throw new ApiError(response.status, message);
  }
}

function csrfToken(): string | undefined {
  const value = document.cookie.split("; ").find((cookie) => cookie.startsWith("plantcare_csrf="));
  return value ? decodeURIComponent(value.split("=").slice(1).join("=")) : undefined;
}

async function jsonMutation<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
  const csrf = csrfToken();
  const response = await fetch(ingressRelative(path), {
    method,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new ApiError(response.status, "The change could not be saved.");
  return (await response.json()) as T;
}

export async function getActions(signal?: AbortSignal): Promise<ActionResponse> {
  const response = await fetch(ingressRelative("/api/v1/actions"), {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new ApiError(response.status, "The care queue could not be loaded.");
  return (await response.json()) as ActionResponse;
}

export function createPlant(payload: PlantCreate): Promise<Plant> {
  return jsonMutation<Plant>("/api/v1/plants", payload);
}

export function updatePlant(plantId: string, payload: PlantCreate): Promise<Plant> {
  return jsonMutation<Plant>(`/api/v1/plants/${plantId}`, payload, "PATCH");
}

export async function uploadPlantPhoto(plantId: string, photo: File): Promise<Plant> {
  const body = new FormData();
  body.append("photo", photo);
  const csrf = csrfToken();
  const response = await fetch(ingressRelative(`/api/v1/plants/${plantId}/photo`), {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
    },
    body,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { detail?: string } | null;
    throw new ApiError(response.status, payload?.detail ?? "The photo could not be saved.");
  }
  return (await response.json()) as Plant;
}

export async function deletePlantPhoto(plantId: string): Promise<void> {
  const csrf = csrfToken();
  const response = await fetch(ingressRelative(`/api/v1/plants/${plantId}/photo`), {
    method: "DELETE",
    credentials: "same-origin",
    headers: csrf ? { "X-CSRF-Token": csrf } : {},
  });
  if (!response.ok) throw new ApiError(response.status, "The photo could not be deleted.");
}

export async function getHomeAssistantEntities(signal?: AbortSignal): Promise<HomeAssistantEntityResponse> {
  const response = await fetch(ingressRelative("/api/v1/home-assistant/entities"), {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new ApiError(response.status, "Home Assistant entities could not be loaded.");
  return (await response.json()) as HomeAssistantEntityResponse;
}

export function updatePlantEntityMapping(plantId: string, payload: PlantEntityMapping): Promise<PlantEntityMapping> {
  return jsonMutation<PlantEntityMapping>(`/api/v1/plants/${plantId}/entity-mapping`, payload, "PATCH");
}

export function syncHomeAssistant(): Promise<void> {
  return jsonMutation<void>("/api/v1/home-assistant/sync");
}

export async function archivePlant(plantId: string): Promise<void> {
  const csrf = csrfToken();
  const response = await fetch(ingressRelative(`/api/v1/plants/${plantId}`), {
    method: "DELETE",
    credentials: "same-origin",
    headers: csrf ? { "X-CSRF-Token": csrf } : {},
  });
  if (!response.ok) throw new ApiError(response.status, "The plant could not be removed.");
}

export function snoozeAction(actionId: string, hours: number): Promise<CareAction> {
  return jsonMutation<CareAction>(`/api/v1/actions/${actionId}/snooze`, { hours });
}

export function completeAction(actionId: string): Promise<CareAction> {
  return jsonMutation<CareAction>(`/api/v1/actions/${actionId}/complete`);
}

export function undoAction(actionId: string): Promise<CareAction> {
  return jsonMutation<CareAction>(`/api/v1/actions/${actionId}/undo`);
}

export function simulateConfirmedWatering(plantId: string): Promise<Plant> {
  return jsonMutation<Plant>(`/api/v1/simulator/plants/${plantId}/confirmed-watering`);
}

export async function getActionHistory(signal?: AbortSignal): Promise<ActionHistoryResponse> {
  const response = await fetch(ingressRelative("/api/v1/actions/history"), {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new ApiError(response.status, "Action history could not be loaded.");
  return (await response.json()) as ActionHistoryResponse;
}

export async function getHealth(): Promise<HealthResponse> {
  const response = await fetch(ingressRelative("/api/v1/health"), { headers: { Accept: "application/json" } });
  if (!response.ok) throw new ApiError(response.status, "Diagnostics are unavailable.");
  return (await response.json()) as HealthResponse;
}
