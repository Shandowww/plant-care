import type { Plant } from "./types";

export function plantStatusLabel(plant: Plant): string {
  if (plant.state !== "good") return {
    watch: "Watch", action_needed: "Action needed", overdue: "Overdue",
    sensor_issue: "Sensor issue",
  }[plant.state];
  if (plant.drying_status === "recently_watered") return "Recently watered";
  if (plant.drying_status === "learning") return "Learning drying pattern";
  if (plant.drying_status === "drying") return "Tracking dry-down";
  if (plant.drying_status === "wet_watch") return "Still very wet";
  return "Good";
}
