export type PlantState = "good" | "watch" | "action_needed" | "overdue" | "sensor_issue";

export interface Plant {
  id: string;
  display_name: string;
  location: string;
  common_name: string;
  scientific_name: string | null;
  environment_type: string;
  state: PlantState;
  moisture: number | null;
  moisture_status: string;
  temperature: number | null;
  temperature_status: string;
  battery: number | null;
  illuminance: number | null;
  photo_updated_at: string | null;
  last_reading_at: string | null;
  highest_priority_action: string | null;
  entity_mapping: PlantEntityMapping | null;
  active: boolean;
}

export interface PlantEntityMapping {
  moisture_entity_id: string | null;
  temperature_entity_id: string | null;
  battery_entity_id: string | null;
  illuminance_entity_id: string | null;
}

export interface HomeAssistantEntity {
  entity_id: string;
  name: string;
  device_class: "moisture" | "humidity" | "temperature" | "battery" | "illuminance" | string | null;
  state: string;
  unit: string | null;
  area_name: string | null;
  device_id: string | null;
}

export interface HomeAssistantEntityResponse {
  source: "simulator" | "home_assistant";
  entities: HomeAssistantEntity[];
  areas: string[];
}

export interface PlantResponse {
  plants: Plant[];
  summary: {
    total: number;
    action_needed: number;
    overdue: number;
    sensor_issues: number;
  };
}

export interface PlantCreate {
  display_name: string;
  location: string;
  common_name: string;
  scientific_name: string | null;
  environment_type: "indoor" | "outdoor_covered" | "outdoor_exposed";
  entity_mapping?: PlantEntityMapping;
}

export type ActionStatus = "open" | "snoozed" | "completed";

export interface CareAction {
  id: string;
  plant_id: string;
  type: string;
  title: string;
  observation: string;
  recommendation: string;
  status: ActionStatus;
  priority: number;
  due_at: string | null;
  snoozed_until: string | null;
  completed_at: string | null;
  completed_by: string | null;
}

export interface ActionResponse {
  actions: CareAction[];
}

export interface ActionHistoryEvent {
  id: string;
  action_id: string;
  actor: string;
  event_type: "action_snoozed" | "action_completed" | "action_auto_completed" | "action_reopened" | "ai_recommendation_created" | "sensor_issue_created";
  old_json: Record<string, unknown> | null;
  new_json: Record<string, unknown> | null;
  occurred_at: string;
}

export interface ActionHistoryResponse {
  events: ActionHistoryEvent[];
}

export interface HealthResponse {
  status: string;
  version: string;
  database: string;
  simulator: boolean;
  plant_doctor_configured: boolean;
  home_assistant_notifications_enabled: boolean;
  stale_sensor_hours: number;
}

export interface PlantDoctorResponse {
  visit_id: string | null;
  summary: string;
  observations: string[];
  possible_issues: string[];
  next_steps: string[];
  confidence: "low" | "medium" | "high";
  provider: string;
  model: string;
  neurons: number | null;
  disclaimer: string;
}

export interface PlantDoctorUsageResponse {
  checks_today: number;
  period_started_at: string;
  resets_at: string;
  daily_free_neuron_limit: number;
  estimated_neurons_per_check: string;
}

export type PlantDoctorDecision = "pending" | "accepted" | "declined";
export type PlantDoctorOutcome = "not_tried" | "helped" | "did_not_help" | "not_sure";

export interface PlantDoctorVisit {
  id: string;
  action_id: string | null;
  summary: string;
  observations: string[];
  possible_issues: string[];
  next_steps: string[];
  sensor_snapshot: Record<string, number | null>;
  confidence: "low" | "medium" | "high";
  provider: string;
  model: string;
  neurons: number | null;
  decision: PlantDoctorDecision;
  outcome: PlantDoctorOutcome;
  created_at: string;
}

export interface PlantDoctorHistoryResponse {
  visits: PlantDoctorVisit[];
}
