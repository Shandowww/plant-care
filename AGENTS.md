## Project Overview

Plant Care is a plant management and monitoring application integrated with
Home Assistant.

The application manages individual plant profiles and provides monitoring,
care recommendations, reminders, and notifications.

Primary users are a small household sharing the same plants and data.

## Core Principles

- Keep implementations simple and maintainable.
- Reuse existing components and patterns before introducing new ones.
- Avoid unnecessary dependencies.
- Prefer extending existing services/components over creating parallel systems.
- Do not change unrelated functionality when implementing a feature.
- Preserve backward compatibility with existing plant data when possible.

## Architecture

Before implementing a feature:

1. Inspect the existing repository structure.
2. Find the closest existing implementation or pattern.
3. Reuse existing services, components, models, and utilities where appropriate.
4. Identify affected files before making broad architectural changes.

Do not assume architecture based only on this document.
The repository is the source of truth.

## Home Assistant

Home Assistant is an important integration and notification surface.

The application may use Home Assistant for:

- sensor data
- soil moisture
- temperature
- weather/environmental data
- notifications
- dashboards

Prefer existing Home Assistant integration mechanisms in the repository.

Do not introduce a second mechanism for functionality that already exists
through the current HA integration.

## Plant Profiles

Plant-specific configuration should live with the plant/profile when practical.

Examples:

- species
- display name
- image
- moisture thresholds
- temperature thresholds
- watering configuration
- seasonal care settings

Species defaults should remain overridable per plant.

## Alerts and Notifications

Alerts should avoid reacting to a single noisy sensor reading when the existing
system supports persistence/consecutive-reading logic.

Use the existing notification architecture.

Potential notification channels include:

- Home Assistant mobile push
- Telegram

Do not implement a new notification channel unless explicitly requested.

## UI

Maintain the existing visual language and component patterns.

Plant information should remain centered around the individual plant profile.

Prefer:

- reusable components
- clear status indicators
- mobile-friendly layouts
- concise actionable information

Avoid duplicating information already available elsewhere in the UI.

## Development Rules

Before editing:

- inspect relevant files
- inspect related tests
- search for existing implementations
- understand current data flow

When implementing:

- make the smallest coherent change
- avoid unrelated refactoring
- preserve existing APIs unless change is necessary
- update tests when behavior changes

After implementing:

- run relevant tests
- run lint/type checks if configured
- report any failures that existed before the change separately

## Codex Workflow

For new features:

1. Understand the request.
2. Inspect relevant code.
3. Briefly state the proposed implementation.
4. Implement the feature.
5. Test the affected area.
6. Summarize:
   - what changed
   - important implementation decisions
   - tests performed
   - remaining issues

Do not perform repository-wide investigation unless necessary.

If the task is ambiguous and the decision could significantly affect
architecture or user-visible behavior, ask before implementing.

For small implementation details, follow existing repository patterns instead
of asking unnecessary questions.
