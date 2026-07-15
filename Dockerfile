# Stage 1: build the SPA
FROM node:22-alpine AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: publish the backend with the SPA bundled into wwwroot
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS backend
WORKDIR /src
COPY backend/ ./backend/
COPY --from=frontend /src/frontend/dist ./frontend/dist
RUN dotnet publish backend/LogHarbor.Api -c Release -o /app \
    -p:SpaDistPath=/src/frontend/dist

# Stage 3: runtime (build stages never ship, so only this stage is hardened)
FROM mcr.microsoft.com/dotnet/aspnet:8.0

# patch base-image CVEs; curl is the one extra package, kept for HEALTHCHECK
# (the aspnet image ships no curl/wget); drop apt caches from the layer
RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends curl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=backend /app ./

# non-root user: /app stays root-owned (app cannot rewrite its own binaries),
# only /data is writable; chown must precede VOLUME to bake the ownership in
RUN groupadd --system logharbor \
    && useradd --system --gid logharbor --no-create-home logharbor \
    && mkdir -p /data \
    && chown logharbor:logharbor /data
VOLUME /data

ENV LogHarbor__DatabasePath=/data/logharbor.db
ENV ASPNETCORE_URLS=http://+:5000
# HOME inside the volume: ASP.NET data-protection keys (session cookies) land in
# $HOME/.aspnet and now survive container replacement instead of logging everyone out
ENV HOME=/data
# no debugger/diagnostics IPC endpoints inside the container
ENV DOTNET_EnableDiagnostics=0
EXPOSE 5000
USER logharbor

# /healthz stays outside the auth gate, so this works with login enabled too
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -fsS http://localhost:5000/healthz || exit 1

ENTRYPOINT ["dotnet", "LogHarbor.Api.dll"]
