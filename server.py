#!/usr/bin/env python3
"""PlantPulse: the Flask server. An MQTT to SSE bridge that also serves the
page, the plant's identity, and the sample packs the browser fetches.

Dumb sensor, secure server, smart client: the ESP32 publishes raw volts, this
process holds the broker credentials and relays them to browsers, and every
musical decision happens in the browser (static/js/). Nothing here needs a
database; the composer keeps its own day of history in the browser.

Naming pitfall: gunicorn's target is `server:app`, this module. Never add a
`server/` package beside it (Python prefers the package and gunicorn then
fails with "Failed to find attribute 'app' in 'server'").
"""

import json
import os
import logging
import re
import threading
from datetime import datetime, timezone

from flask import Flask, Response, abort, jsonify, request, send_from_directory

# gevent-compatible queue when available (gunicorn gevent worker)
try:
    from gevent.queue import Queue, Empty
except ImportError:
    from queue import Queue, Empty

import paho.mqtt.client as mqtt_client

log = logging.getLogger("plantpulse")

HERE = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__, static_folder="static", static_url_path="/static")

MQTT_HOST = os.environ.get("MQTT_HOST", "mosquitto")
MQTT_PORT = int(os.environ.get("MQTT_PORT", 1883))
MQTT_USER = os.environ.get("MQTT_USER", "plantpulse")
MQTT_PASS = os.environ.get("MQTT_PASS", "")
MQTT_TOPICS = {
    "plantpulse/sensor/plant_signal/state": "ch1",    # Chip 1 A0-A1, alligator clips
    "plantpulse/sensor/plant_signal_2/state": "ch2",  # Chip 1 A2-A3, alligator clips
    "plantpulse/sensor/plant_signal_3/state": "ch3",  # Chip 2 A0-A1, optional
}

# Sample packs built by tools/fetch-samples (never committed; see NOTICE.md).
SAMPLES_DIR = os.environ.get("PLANTPULSE_SAMPLES_DIR", os.path.join(HERE, "samples", "web"))
# Take logs the browser composer posts (the same JSONL the live engine writes;
# tools/take-review reads them).
RECORDINGS_DIR = os.environ.get("PLANTPULSE_RECORDINGS_DIR", os.path.join(HERE, "recordings"))


# --- MQTT → SSE fan-out ---

_clients_lock = threading.Lock()
_clients = []  # one Queue per SSE connection


def _enqueue(payload: str):
    with _clients_lock:
        dead = []
        for q in _clients:
            try:
                q.put_nowait(payload)
            except Exception:
                dead.append(q)
        for q in dead:
            _clients.remove(q)


def _on_connect(client, userdata, flags, rc):
    if rc == 0:
        for topic in MQTT_TOPICS:
            log.info("MQTT subscribing to %s", topic)
            client.subscribe(topic)
    else:
        log.warning("MQTT connect failed rc=%d", rc)


def _on_message(client, userdata, msg):
    channel = MQTT_TOPICS.get(msg.topic)
    if channel is None:
        return
    try:
        _enqueue(json.dumps({"ch": channel, "v": float(msg.payload.decode())}))
    except Exception:
        log.warning("bad payload on %s: %r", msg.topic, msg.payload)


_mqtt_started = False


def _start_mqtt():
    """Connect in the background and keep retrying. connect_async + loop_start
    means a broker that comes up after this process (the usual compose race)
    is picked up without a restart; the old synchronous connect swallowed the
    first failure and left the server deaf for good."""
    global _mqtt_started
    if _mqtt_started:
        return
    _mqtt_started = True
    client = mqtt_client.Client(client_id=f"plantpulse-web-{os.getpid()}", clean_session=True)
    client.username_pw_set(MQTT_USER, MQTT_PASS)
    client.on_connect = _on_connect
    client.on_message = _on_message
    client.reconnect_delay_set(min_delay=1, max_delay=30)
    client.connect_async(MQTT_HOST, MQTT_PORT, keepalive=60)
    client.loop_start()
    log.info("MQTT subscriber started (pid=%d, broker %s:%d)", os.getpid(), MQTT_HOST, MQTT_PORT)


# --- Pages ---

@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/config.json")
def config():
    """The plant's identity (name, type, location). No credentials."""
    path = os.path.join(app.static_folder, "config.json")
    if not os.path.exists(path):
        return jsonify({})
    with open(path) as f:
        return jsonify(json.load(f))


@app.route("/logo.svg")
def logo():
    return send_from_directory("static", "logo.svg")


@app.route("/healthz")
def healthz():
    """Liveness for the compose healthcheck. Cheap on purpose: no broker
    round-trip; "process up and serving" is the claim."""
    with _clients_lock:
        sse = len(_clients)
    return jsonify({"ok": True, "sse_clients": sse, "mqtt_started": _mqtt_started})


# --- The signal ---

@app.route("/api/stream")
def stream():
    """Server-Sent Events: relays the plant's readings to browsers as
    {"ch": "ch1", "v": <volts>}, with {"hb": 1} every 5 s when the plant is
    quiet (a data frame, not a comment, so the client's watchdog sees it)."""
    _start_mqtt()

    def event_stream():
        q = Queue(maxsize=50)
        with _clients_lock:
            _clients.append(q)
        try:
            while True:
                try:
                    yield f"data: {q.get(timeout=5)}\n\n"
                except Empty:
                    yield f"data: {json.dumps({'hb': 1})}\n\n"
        except GeneratorExit:
            pass
        finally:
            with _clients_lock:
                if q in _clients:
                    _clients.remove(q)

    return Response(event_stream(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# --- Sample packs (tools/fetch-samples) ---

def _safe_segment(s):
    """Reject any path segment that contains separators, traversal, or null bytes."""
    return bool(s) and "/" not in s and "\\" not in s and ".." not in s and "\x00" not in s


def _load_pack_manifest(pack):
    with open(os.path.join(SAMPLES_DIR, pack, "manifest.json")) as f:
        return json.load(f)


@app.route("/api/samples/<pack>/manifest")
def pack_manifest(pack):
    """{pack, version, baseUrl, urls, release, layers?, notes?, instrument?, extras?}.
    404 unknown_pack when the library has not been fetched: the page then says
    so, and the drift room plays regardless (it needs no samples)."""
    if not _safe_segment(pack):
        abort(404)
    try:
        manifest = _load_pack_manifest(pack)
    except FileNotFoundError:
        return jsonify({"error": "unknown_pack"}), 404
    version = manifest.get("version", 1)
    payload = {"pack": pack, "version": version, "baseUrl": f"/api/samples/{pack}/{version}/",
               "urls": manifest.get("urls", {}), "release": manifest.get("release", 1)}
    for extra in ("layers", "notes", "instrument", "extras"):
        if extra in manifest:
            payload[extra] = manifest[extra]
    return jsonify(payload)


@app.route("/api/samples/<pack>/<int:version>/<filename>")
def pack_file(pack, version, filename):
    if not (_safe_segment(pack) and _safe_segment(filename)):
        abort(404)
    try:
        manifest = _load_pack_manifest(pack)
    except FileNotFoundError:
        return jsonify({"error": "unknown_pack"}), 404
    if version != manifest.get("version", 1):
        return jsonify({"error": "stale_version"}), 404
    pack_dir = os.path.join(SAMPLES_DIR, pack)
    if not os.path.isfile(os.path.join(pack_dir, filename)):
        abort(404)
    response = send_from_directory(pack_dir, filename)
    # The version is in the URL, so the file can be cached forever; bump the
    # pack's version in its manifest to bust.
    response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return response


# --- Take receipts ---

_TAKE_NAME = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}__[a-z]+__web$")


@app.route("/api/take", methods=["POST"])
def take_post():
    """The browser composer posts one finished take: {"meta": {...},
    "lines": ["<jsonl line>", ...]}. The lines land in
    recordings/spool/<stamp>__<room>__web.notes.jsonl and the meta is appended
    to recordings/takes.jsonl, the two files tools/take-review reads. Nothing
    is served back: receipts, not a feature."""
    body = request.get_json(silent=True) or {}
    meta, lines = body.get("meta"), body.get("lines")
    if not isinstance(meta, dict) or not isinstance(lines, list):
        return jsonify({"error": "bad take"}), 400
    name = str(meta.get("wav_filename", ""))
    if not _TAKE_NAME.match(name) or len(lines) > 200000:
        return jsonify({"error": "bad take name"}), 400
    spool = os.path.join(RECORDINGS_DIR, "spool")
    try:
        os.makedirs(spool, exist_ok=True)
        with open(os.path.join(spool, f"{name}.notes.jsonl"), "w") as f:
            for line in lines:
                if isinstance(line, str):
                    f.write(line.rstrip("\n") + "\n")
        meta = dict(meta)
        meta["logged_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        with open(os.path.join(RECORDINGS_DIR, "takes.jsonl"), "a") as f:
            f.write(json.dumps(meta, separators=(",", ":")) + "\n")
    except OSError as exc:
        log.warning("take: could not write %s: %s", name, exc)
        return jsonify({"error": "not writable"}), 503
    return jsonify({"ok": True, "take": name})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8286, debug=True)
