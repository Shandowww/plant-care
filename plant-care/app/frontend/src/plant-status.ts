import type { Plant } from "./types";

export function plantStatusLabel(plant: Plant, locale: "en" | "he" = "en"): string {
  if (locale === "he") {
    if (plant.state !== "good") return {
      watch: "מעקב", action_needed: "נדרש טיפול", overdue: "באיחור",
      sensor_issue: "בעיית חיישן",
    }[plant.state];
    if (plant.drying_status === "recently_watered") return "הושקה לאחרונה";
    if (plant.drying_status === "learning") return "לומד את דפוס הייבוש";
    if (plant.drying_status === "drying") return "עוקב אחר הייבוש";
    if (plant.drying_status === "wet_watch") return "עדיין רטוב מאוד";
    return "תקין";
  }
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
