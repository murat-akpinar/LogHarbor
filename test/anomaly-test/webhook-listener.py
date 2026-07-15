#!/usr/bin/env python3
"""Minimal webhook receiver for the anomaly test harness.

Appends each POST body (LogHarbor alert payload) to webhook.log with a UTC timestamp
and echoes it. Binds 127.0.0.1 only (the alert evaluator runs on the same host).
Usage: python3 webhook-listener.py [port]   # default 9099
"""
import datetime
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9099
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
    print(f"listening on 127.0.0.1:{PORT}, appending to {LOG}", flush=True)
    HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
