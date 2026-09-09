import {
  BatteryMedium,
  Camera,
  ChevronRight,
  CircleAlert,
  Clock3,
  Droplets,
  MapPin,
  Thermometer,
  WifiOff,
} from "lucide-react";
import type { Plant, PlantState } from "./types";
import { plantImage } from "./plant-images";

const stateContent: Record<PlantState, { label: string; icon: typeof CircleAlert }> = {
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

function timeAgo(value: string | null): string {
  if (!value) return "No valid reading";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

function BotanicalVisual({ plant }: { plant: Plant }) {
  const image = plantImage(plant);
  if (image) {
    return <>
      <img className="plant-reference-image" src={image.src} alt={image.alt} />
    </>;
  }
  const variant = visualVariant[plant.display_name] ?? "sprout";
  return (
    <div className={`botanical botanical--${variant}`} role="img" aria-label={`${plant.common_name} reference placeholder`}>
      <span className="leaf leaf--one" />
      <span className="leaf leaf--two" />
      <span className="leaf leaf--three" />
      <span className="leaf leaf--four" />
      {variant === "flower" && <span className="bloom" />}
      <span className="pot" />
    </div>
  );
}

export function PlantCard({ plant, onDetails, onPhoto }: { plant: Plant; onDetails: (plant: Plant) => void; onPhoto: (plant: Plant) => void }) {
  const state = stateContent[plant.state];
  const StateIcon = state.icon;
  return (
    <article className={`plant-card plant-card--${plant.state}`} aria-labelledby={`plant-${plant.id}`} onClick={() => onDetails(plant)}>
      <div className="plant-card__visual">
        <BotanicalVisual plant={plant} />
        <span className={`status-pill status-pill--${plant.state}`}>
          <StateIcon size={14} strokeWidth={2.4} aria-hidden="true" />
          {state.label}
        </span>
      </div>
      <div className="plant-card__body">
        <div className="plant-card__identity">
          <div>
            <h2 id={`plant-${plant.id}`}>{plant.display_name}</h2>
            <p>{plant.scientific_name ?? "Species not confirmed"}</p>
          </div>
          <span className="location"><MapPin size={13} aria-hidden="true" />{plant.location}</span>
        </div>

        <div className="readings" aria-label="Latest readings">
          <div className={`reading reading--${plant.moisture_status}`}>
            <Droplets size={17} aria-hidden="true" />
            <span><strong>{plant.moisture === null ? "—" : `${plant.moisture}%`}</strong>Moisture</span>
          </div>
          <div className={`reading reading--${plant.temperature_status}`}>
            <Thermometer size={17} aria-hidden="true" />
            <span><strong>{plant.temperature === null ? "—" : `${plant.temperature.toFixed(1)}°`}</strong>Local temp</span>
          </div>
          <div className={`reading ${plant.battery !== null && plant.battery < 20 ? "reading--low" : ""}`}>
            <BatteryMedium size={17} aria-hidden="true" />
            <span><strong>{plant.battery === null ? "—" : `${plant.battery}%`}</strong>Battery</span>
          </div>
        </div>

        {plant.highest_priority_action ? (
          <div className="next-action">
            <span>Next action</span>
            <strong>{plant.highest_priority_action}</strong>
          </div>
        ) : (
          <div className="next-action next-action--clear">
            <span>Care queue</span>
            <strong>No action needed</strong>
          </div>
        )}

        <div className="plant-card__footer">
          <span className="last-reading"><Clock3 size={13} aria-hidden="true" />{timeAgo(plant.last_reading_at)}</span>
          <div className="card-actions">
            <button className="icon-button" type="button" aria-label={`Manage ${plant.display_name} photo`} onClick={(event) => { event.stopPropagation(); onPhoto(plant); }}>
              <Camera size={17} aria-hidden="true" />
            </button>
            <button className="detail-button" type="button" aria-label={`Open ${plant.display_name} details`} onClick={(event) => { event.stopPropagation(); onDetails(plant); }}>
              Details <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
