# Ingesting Docker Container Logs

Collect logs from existing Docker projects with zero changes to those projects.

--- HOW IT WORKS ---

Docker captures stdout/stderr of every container (json-file log driver, the default).
A single Vector container on the same host reads those logs and POSTs them
to LogHarbor /api/events/raw as CLEF. The monitored project is not modified.

[app containers] -> [docker logs on disk] -> [Vector] -> HTTP CLEF -> [LogHarbor]

--- VECTOR SETUP (ONE PER MONITORED HOST) ---

Three files in their own directory, e.g. /opt/logharbor-vector/. Nothing here belongs to
the monitored projects, so it can be added and removed independently.

.env  (never committed, the API key is a secret)

  LOGHARBOR_URL=http://LOGHARBOR_HOST:5000
  LOGHARBOR_API_KEY=logharbor_xxxxxxxxxxxxxxxx

docker-compose.yml

  services:
    vector:
      image: timberio/vector:latest-alpine
      restart: unless-stopped
      env_file: .env
      volumes:
        - /var/run/docker.sock:/var/run/docker.sock:ro
        - ./vector.yaml:/etc/vector/vector.yaml:ro
        - vector-data:/var/lib/vector

  volumes:
    vector-data:

vector.yaml

  data_dir: /var/lib/vector

  sources:
    docker:
      type: docker_logs
      exclude_containers: ["vector"]

  transforms:
    to_clef:
      type: remap
      inputs: ["docker"]
      source: |
        # docker compose labels every container it starts with the project and service
        # name, so App/Service need no per-project configuration here
        app = .label."com.docker.compose.project"
        service = .label."com.docker.compose.service"
        if is_null(app) { app = .container_name }
        if is_null(service) { service = .container_name }

        text = string!(.message)
        upper = upcase(text)
        level = "Information"
        if contains(upper, "ERROR") || contains(upper, "FATAL") { level = "Error" }
        else if contains(upper, "WARN") { level = "Warning" }

        . = {
          "@t": format_timestamp!(.timestamp, "%+"),
          "@l": level,
          "@m": text,
          "App": app,
          "Service": service,
          "ContainerName": .container_name,
          "Image": .image,
          "Host": .host
        }

  sinks:
    logharbor:
      type: http
      inputs: ["to_clef"]
      uri: "${LOGHARBOR_URL}/api/events/raw"
      encoding:
        codec: json
      framing:
        method: newline_delimited
      request:
        headers:
          X-LogHarbor-ApiKey: "${LOGHARBOR_API_KEY}"
          Content-Type: "application/vnd.serilog.clef"
      batch:
        max_events: 500
        timeout_secs: 2
      buffer:
        type: disk
        max_size: 268435488
        when_full: block

Run:   docker compose up -d
Check: docker compose logs -f vector   (401 = bad key, 413 = batch too large, 429 = rate limited)

Vector must exclude its own container: a failed POST makes Vector log an error, which
would be shipped as an event, which fails again -> feedback loop.
The disk buffer keeps logs while LogHarbor is down or restarting; without it the in-memory
default drops them.

--- MULTIPLE PROJECTS, ONE VECTOR ---

One Vector per host already sees every container on that host, so a second project needs
no Vector change at all. The compose project name (directory name by default, or
COMPOSE_PROJECT_NAME / docker compose -p) arrives as App:

  /srv/git-effort  ->  App = 'git-effort'   Service = 'backend' | 'frontend' | ...
  /srv/shop-api    ->  App = 'shop-api'     Service = 'api' | 'worker' | ...

Filters, each worth saving as a Signal:

  App = 'git-effort'                            one project
  App = 'shop-api' and @Level = 'Error'         one project, errors only
  Service = 'backend'                           same service across all projects
  Host = 'prod-1' and @Level = 'Error'          one machine

To leave a project or a noisy dependency out, extend the source:
  exclude_containers: ["vector", "postgres", "redis"]   (prefix match on container name)

--- MULTIPLE HOSTS ---

One Vector per host, all pointing at the same LogHarbor, each with its own API key
("vector prod-1", "vector prod-2") so a leaked key is revoked without stopping the rest.

Keys authenticate, properties classify. Events do not record which key ingested them,
so filter by App/Host/Service, never by key.

--- EVENT SHAPE IN LOGHARBOR ---

@m             raw log line from the container
@l             level guessed from the line text (Error/Warning/Information)
App            compose project name    -> filter: App = 'git-effort'
Service        compose service name    -> filter: Service = 'backend'
ContainerName  e.g. git-effort-backend-1
Image, Host    extra context properties

--- LIMITATIONS (ZERO-CHANGE MODE) ---

Log lines arrive as plain text, not structured fields
Level detection is text-based, best effort
Multiline stack traces may arrive as separate events (Vector multiline merge can fix this)

--- NGINX / APACHE LOGS ---

Containerized nginx (like git-effort_frontend): official images pipe access.log and
error.log to stdout/stderr, so the docker_logs source above already captures them.

Host-installed nginx/apache: add a file source instead:

sources:
  nginx_files:
    type: file
    include: ["/var/log/nginx/access.log", "/var/log/nginx/error.log"]

Parse access lines into structured fields (status, path, method, client IP):

transforms:
  nginx_parsed:
    type: remap
    inputs: ["nginx_files"]
    source: |
      parsed, err = parse_nginx_log(.message, "combined")
      if err == null {
        level = "Information"
        if to_int(parsed.status) ?? 0 >= 500 { level = "Error" }
        else if to_int(parsed.status) ?? 0 >= 400 { level = "Warning" }
        . = {
          "@t": format_timestamp!(.timestamp, "%+"),
          "@l": level,
          "@mt": "{Method} {Path} -> {StatusCode}",
          "@m": string!(.message),
          "Method": parsed.method,
          "Path": parsed.path,
          "StatusCode": to_int(parsed.status) ?? 0,
          "ClientIp": parsed.client,
          "BytesSent": to_int(parsed.size) ?? 0,
          "Source": "nginx"
        }
      }

Apache: use parse_apache_log(.message, "combined") the same way.
Result: queries like StatusCode >= 500 and Path like '/api/%' work in the UI.

--- UPGRADE PATH (OPTIONAL, PER APP) ---

Python apps: switch logging to JSON (python-json-logger) or use seqlog to POST
CLEF directly to LogHarbor; then real structured properties become queryable.
Requires an app change, so it is optional and per project.

--- REQUIREMENTS ---

LogHarbor reachable from the monitored host (network/firewall)
An active LogHarbor API key (Settings page)
Docker json-file log driver on the monitored containers (default)
