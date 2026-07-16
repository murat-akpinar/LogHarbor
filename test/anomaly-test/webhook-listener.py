#!/usr/bin/env python3
"""Minimal webhook receiver for the anomaly test harness.

Appends each POST body (LogHarbor alert payload) to webhook.log with a UTC timestamp
and echoes it.
Usage: python3 webhook-listener.py [port] [bind_host]   # default 9099 127.0.0.1

bind_host defaults to 127.0.0.1 (loopback only). When LogHarbor runs in a container it
cannot reach the host's 127.0.0.1, so bind to the docker bridge gateway (e.g. 172.19.0.1)
instead — reachable from the container but still off the LAN.
"""
import datetime
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9099
BIND = sys.argv[2] if len(sys.argv) > 2 else "127.0.0.1"
LOG = "webhook.log"


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode("utf-8", "replace")
        stamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
        line = f"{stamp}  {self.path}  {body}\n"
        with open(LOG, "a", encoding="utf-8") as handle:
            handle.write(line)
        print(line, end="", flush=True)
        self.send_response(200)
        self.end_headers()

    def log_message(self, *_args):  # silence default access logging
        pass


if __name__ == "__main__":
    print(f"listening on {BIND}:{PORT}, appending to {LOG}", flush=True)
    HTTPServer((BIND, PORT), Handler).serve_forever()
