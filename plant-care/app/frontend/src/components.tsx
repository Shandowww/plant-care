import {
  BatteryMedium,
  ChevronRight,
  CircleAlert,
  Clock3,
  Droplets,
  MapPin,
  Thermometer,
  WifiOff,
} from "lucide-react";
import { useState } from "react";
import type { Plant, PlantState } from "./types";
import { plantImage } from "./plant-images";
import { plantStatusLabel } from "./plant-status";
import { useI18n } from "./i18n";

const stateContent: Record<
  PlantState,
  { label: string; icon: typeof CircleAlert }
> = {
  good: { label: "Good", icon: Clock3 },
  watch: { label: "Watch", icon: CircleAlert },
  action_needed: { label: "Action needed", icon: CircleAlert },
  overdue: { label: "Overdue", icon: Clock3 },
  sensor_issue: { label: "Sensor issue", icon: WifiOff },
};


const visualVariant: Record<string, string> = {
  "Snake Plant": "spikes",
  "Golden Pothos": "trailing",
  Monstera: "broad",
  "Olive Tree": "tree",
  "Peace Lily": "flower",
};

function timeAgo(value: string | null, t: ReturnType<typeof useI18n>["t"]): string {
  if (!value) return t("time.noReading", "No valid reading");
  const minutes = Math.max(
    0,
    Math.round((Date.now() - new Date(value).getTime()) / 60_000),
  );
  if (minutes < 60) return t("time.minutesAgo", "{{count}}m ago", { count: minutes });
  const hours = Math.round(minutes / 60);
  return hours < 48
    ? t("time.hoursAgo", "{{count}}h ago", { count: hours })
    : t("time.daysAgo", "{{count}}d ago", { count: Math.round(hours / 24) });
}

function BotanicalVisual({ plant }: { plant: Plant }) {
  const { t } = useI18n();
  const image = plantImage(plant);
  if (image) {
    return (
      <>
        <img
          className="plant-reference-image"
          src={image.src}
          alt={image.alt}
        />
      </>
    );
  }
  const variant = visualVariant[plant.display_name] ?? "sprout";
  return (
    <div
      className={`botanical botanical--${variant}`}
      role="img"
      aria-label={t("plant.reference", "{{name}} reference placeholder", { name: plant.common_name })}
    >
      <span className="leaf leaf--one" />
      <span className="leaf leaf--two" />
      <span className="leaf leaf--three" />
      <span className="leaf leaf--four" />
      {variant === "flower" && <span className="bloom" />}
      <span className="pot" />
    </div>
  );
}

export function PlantCard({
  plant,
  onDetails,
}: {
  plant: Plant;
  onDetails: (plant: Plant) => void;
}) {
  const { locale, t } = useI18n();
  const state = stateContent[plant.state];
  const StateIcon = state.icon;
  const [temperatureOpen, setTemperatureOpen] = useState(false);
  const [moistureOpen, setMoistureOpen] = useState(false);
  const temperatureRangeId = `temperature-range-${plant.id}`;
  const moistureRangeId = `moisture-range-${plant.id}`;
  return (
    <article
      className={`plant-card plant-card--${plant.state}`}
      aria-labelledby={`plant-${plant.id}`}
      onClick={() => onDetails(plant)}
    >
      <div className="plant-card__visual">
        <BotanicalVisual plant={plant} />
        <span className={`status-pill status-pill--${plant.drying_status === "wet_watch" ? "watch" : plant.state}`}>
          <StateIcon size={14} strokeWidth={2.4} aria-hidden="true" />
          {plantStatusLabel(plant, locale)}
        </span>
      </div>
      <div className="plant-card__body">
        {plant.drying_note && <p className="drying-note">{plant.drying_note}</p>}
        <div className="plant-card__identity">
          <div>
            <h2 id={`plant-${plant.id}`}>{plant.display_name}</h2>
            <p>{plant.scientific_name ?? t("plant.speciesUnknown", "Species not confirmed")}</p>
          </div>
          <span className="location">
            <MapPin size={13} aria-hidden="true" />
            {plant.location}
            {plant.specific_position ? ` · ${plant.specific_position}` : ""}
          </span>
        </div>

        <div className="readings" aria-label={t("plant.latestReadings", "Latest readings")}>
          <button
            className={`reading reading-button reading--${plant.moisture_status}`}
            type="button"
            aria-label={t("plant.moistureA11y", "Moisture {{value}}; show monitoring thresholds", {
              value: plant.moisture === null ? t("plant.unavailable", "unavailable") : `${plant.moisture} percent`,
            })}
            aria-expanded={moistureOpen}
            aria-controls={moistureRangeId}
            onClick={(event) => {
              event.stopPropagation();
              setMoistureOpen((open) => !open);
            }}
          >
            <Droplets size={17} aria-hidden="true" />
            <span>
              <strong>
                {plant.moisture === null ? "—" : `${plant.moisture}%`}
              </strong>
              {t("plant.moisture", "Moisture")}
            </span>
          </button>
          <button
            className={`reading reading-button reading--${plant.temperature_status}`}
            type="button"
            aria-label={t("plant.temperatureA11y", "Temperature {{value}}; show normal range", {
              value: plant.temperature === null ? t("plant.unavailable", "unavailable") : `${plant.temperature.toFixed(1)} degrees Celsius`,
            })}
            aria-expanded={temperatureOpen}
            aria-controls={temperatureRangeId}
            onClick={(event) => {
              event.stopPropagation();
              setTemperatureOpen((open) => !open);
            }}
          >
            <Thermometer size={17} aria-hidden="true" />
            <span>
              <strong>
                {plant.temperature === null
                  ? "—"
                  : `${plant.temperature.toFixed(1)}°`}
              </strong>
              {t("plant.temp", "Temp")}
            </span>
          </button>
          <div
            className={`reading ${plant.battery !== null && plant.battery < 10 ? "reading--low" : ""}`}
          >
            <BatteryMedium size={17} aria-hidden="true" />
            <span>
              <strong>
                {plant.battery === null ? "—" : `${plant.battery}%`}
              </strong>
              {t("plant.battery", "Battery")}
            </span>
          </div>
          {moistureOpen && (
            <div
              className="reading-range-note"
              id={moistureRangeId}
              role="status"
              onClick={(event) => event.stopPropagation()}
            >
              <strong>
                {t("plant.wateringThreshold", "Watering check at or below {{value}}%", { value: plant.moisture_check_threshold })}
              </strong>
              <span>
                {t("plant.wetThreshold", "Wet tracking at or above {{value}}%. Alerts use drying history or your custom duration. {{basis}}{{profile}}. Calibrate thresholds for your sensor, substrate, and placement.", {
                  value: plant.moisture_wet_threshold,
                  basis: plant.care_profile_basis,
                  profile: plant.moisture_thresholds_custom
                    ? t("plant.customThresholds", " · custom thresholds")
                    : t("plant.startingProfile", " · starting profile"),
                })}
              </span>
            </div>
          )}
          {temperatureOpen && (
            <div
              className="reading-range-note"
              id={temperatureRangeId}
              role="status"
              onClick={(event) => event.stopPropagation()}
            >
              <strong>
                {t("plant.temperatureRange", "Normal temperature range: {{min}}–{{max}}°C", {
                  min: plant.temperature_minimum,
                  max: plant.temperature_maximum,
                })}
              </strong>
              <span>
                {t("plant.temperatureGuidance", "{{basis}}. Guidance only; temperature alerts are not automated yet.", { basis: plant.care_profile_basis })}
              </span>
            </div>
          )}
        </div>

        {plant.highest_priority_action ? (
          <div className="next-action">
            <span>{t("plant.nextAction", "Next action")}</span>
            <strong>{plant.highest_priority_action}</strong>
          </div>
        ) : (
          <div className="next-action next-action--clear">
            <span>{t("plant.careQueue", "Care queue")}</span>
            <strong>{t("plant.noAction", "No action needed")}</strong>
          </div>
        )}

        <div className="plant-card__footer">
          <span className="last-reading">
            <Clock3 size={13} aria-hidden="true" />
            {timeAgo(plant.last_reading_at, t)}
          </span>
          <div className="card-actions">
            <button
              className="detail-button"
              type="button"
              aria-label={t("plant.openDetails", "Open {{name}} details", { name: plant.display_name })}
              onClick={(event) => {
                event.stopPropagation();
                onDetails(plant);
              }}
            >
              {t("plant.details", "Details")} <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
