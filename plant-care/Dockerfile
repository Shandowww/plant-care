ARG BUILD_ARCH=amd64

FROM node:22.18.0-alpine3.22 AS frontend-build
WORKDIR /build/frontend
COPY app/frontend/package.json app/frontend/package-lock.json ./
RUN npm ci
COPY app/frontend/ ./
RUN npm run build

FROM python:3.14-alpine3.22 AS backend-build
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
WORKDIR /build
COPY pyproject.toml ./
COPY app/backend/ ./app/backend/
RUN pip install --no-cache-dir --upgrade pip==26.2.1 && \
    pip install --no-cache-dir .

FROM python:3.14-alpine3.22
ARG BUILD_ARCH
ARG BUILD_VERSION=0.5.1

RUN apk add --no-cache jq nginx supervisor tzdata
COPY --from=backend-build /opt/venv /opt/venv
COPY --from=frontend-build /build/frontend/dist /app/frontend
COPY app/backend /app/app/backend
COPY app/migrations /app/app/migrations
COPY alembic.ini pyproject.toml /app/
COPY rootfs /
RUN chmod +x /run-plantcare.sh && \
    mkdir -p \
      /run/nginx \
      /data \
      /var/lib/nginx/logs \
      /var/lib/nginx/tmp/client_body \
      /var/lib/nginx/tmp/proxy \
      /var/lib/nginx/tmp/fastcgi \
      /var/lib/nginx/tmp/uwsgi \
      /var/lib/nginx/tmp/scgi && \
    chown -R nginx:nginx /var/lib/nginx

LABEL \
  io.hass.name="Plant Care Dashboard" \
  io.hass.description="Local-first plant sensor guidance and care actions" \
  io.hass.version="${BUILD_VERSION}" \
  io.hass.type="app" \
  io.hass.arch="${BUILD_ARCH}"

EXPOSE 8098 8099
WORKDIR /app
CMD ["/run-plantcare.sh"]
