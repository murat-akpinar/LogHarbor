# Ingesting Docker Container Logs

Collect logs from existing Docker projects with zero changes to those projects.

--- HOW IT WORKS ---

Docker captures stdout/stderr of every container (json-file log driver, the default).
A single Vector container on the same host reads those logs and POSTs them
to LogHarbor /api/events/raw as CLEF. The monitored project is not modified.

[app containers] -> [docker logs on disk] -> [Vector] -> HTTP CLEF -> [LogHarbor]

--- VECTOR SETUP (ONE PER MONITORED HOST) ---

Two files in their own directory, e.g. /opt/logharbor-vector/. Nothing here belongs to
the monitored projects, so it can be added and removed independently.

There is no .env file, and the URL and API key are written literally into vector.yaml.
Vector does not expand ${VAR} or $VAR in this config — verified end to end against Vector
0.57, in both the sink's `uri` and its `request.headers`. Each failure is quiet in its own
way, which is worse than an outright crash:

  in uri     -> "invalid uri character" per request ($ { } are not legal in a URI)
  in headers -> the literal text is sent as the key, LogHarbor answers 401, and Vector
                logs `Not retriable; dropping the request. reason="Unauthorized"`

In both cases the sink's healthcheck still passes and Vector reports itself started and
healthy, so the setup looks fine while every event is dropped.

Because the key ends up in vector.yaml, that file is the secret: keep it out of version
control and `chmod 600` it. The LogHarbor URL is not sensitive.

docker-compose.yml

  services:
    vector:
      image: timberio/vector:latest-alpine
      restart: unless-stopped
      # name the monitored host: without this the Vector container's own id lands in the
      # Host property of every event, and `Host = 'prod-1'` matches nothing
      hostname: prod-1
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
      # literal, not ${LOGHARBOR_URL} — see the note above. This is resolved from inside
      # the container, so it must be an address the container can reach: the LogHarbor
      # machine's address, or the docker bridge gateway (172.17.0.1) when LogHarbor runs
      # on this same host. `localhost` here means the Vector container itself.
      uri: "http://LOGHARBOR_HOST:5000/api/events/raw"
      encoding:
        codec: json
      framing:
        method: newline_delimited
      request:
        headers:
          # literal too: this is why the file is the secret (chmod 600, never committed)
          X-LogHarbor-ApiKey: "logharbor_xxxxxxxxxxxxxxxx"
          Content-Type: "application/vnd.serilog.clef"
      batch:
        max_events: 500
        timeout_secs: 2
      buffer:
        type: disk
        max_size: 268435488
        when_full: block

Run:    docker compose up -d
Check:  docker compose logs -f vector
Verify: the log alone is not proof — Vector reports "Vector has started" and passes its
        healthcheck even when every event is being dropped. Confirm from the LogHarbor
        side that events actually arrived:

          filter  Has(ContainerName)      in the Events page

        and look for ERROR lines in the Vector log, which is where the real answer is:
          reason="Unauthorized"          bad or unexpanded API key
          "invalid uri character"        the uri is not a literal URL
          413 / 429                      batch too large / rate limited

After changing vector.yaml, recreate the volume as well as the container:
`docker compose down -v && docker compose up -d`. The disk buffer survives a plain
restart and keeps replaying the old failed batch, which hides whether the fix worked.

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
