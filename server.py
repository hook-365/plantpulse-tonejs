#!/usr/bin/env python3
"""PlantPulse — Flask server with SSE-based MQTT proxy."""

import json
import os
import logging
import threading
from datetime import datetime, timedelta, timezone

from flask import Flask, Response, jsonify, request, send_from_directory
import psycopg2
from psycopg2.extras import RealDictCursor

# Use gevent-compatible queue when available (gunicorn gevent worker)
try:
    from gevent.queue import Queue, Empty
except ImportError:
    from queue import Queue, Empty

import paho.mqtt.client as mqtt_client

log = logging.getLogger("plantpulse")

app = Flask(__name__, static_folder="static", static_url_path="/static")

DB_CONFIG = {
    "host": os.environ.get("DB_HOST", "timescaledb"),
    "port": int(os.environ.get("DB_PORT", 5432)),
    "dbname": os.environ.get("DB_NAME", "plantpulse"),
    "user": os.environ.get("DB_USER", "plantpulse"),
    "password": os.environ.get("DB_PASS", "plantpulse"),
}

MQTT_HOST = os.environ.get("MQTT_HOST", "mosquitto")
MQTT_PORT = int(os.environ.get("MQTT_PORT", 1883))
MQTT_USER = os.environ.get("MQTT_USER", "plantpulse")
MQTT_PASS = os.environ.get("MQTT_PASS", "")
MQTT_TOPICS = {
    "plantpulse/sensor/plant_signal/state": "ch1",    # Chip 1 A0-A1, alligator clips
    "plantpulse/sensor/plant_signal_2/state": "ch2",  # Chip 1 A2-A3, alligator clips
    "plantpulse/sensor/plant_signal_3/state": "ch3",  # Chip 2 A0-A1, TENS pads
}


# --- MQTT → SSE fan-out ---

_clients_lock = threading.Lock()
_clients = []  # list of Queue objects, one per SSE connection


def _on_connect(client, userdata, flags, rc):
    if rc == 0:
        for topic in MQTT_TOPICS:
            log.info("MQTT subscribing to %s", topic)
            client.subscribe(topic)
    else:
        log.warning("MQTT connect failed rc=%d", rc)


def _on_message(client, userdata, msg):
    channel = MQTT_TOPICS.get(msg.topic, "ch1")
    value = msg.payload.decode()
    payload = json.dumps({"ch": channel, "v": float(value)})
    with _clients_lock:
        dead = []
        for q in _clients:
            try:
                q.put_nowait(payload)
            except Exception:
                dead.append(q)
        for q in dead:
            _clients.remove(q)


_mqtt_started = False

def _start_mqtt():
    global _mqtt_started
    if _mqtt_started:
        return
    _mqtt_started = True
    client = mqtt_client.Client(
        client_id=f"plantpulse-web-{os.getpid()}",
        clean_session=True,
    )
    client.username_pw_set(MQTT_USER, MQTT_PASS)
    client.on_connect = _on_connect
    client.on_message = _on_message
    client.reconnect_delay_set(min_delay=1, max_delay=30)
    try:
        client.connect(MQTT_HOST, MQTT_PORT, keepalive=60)
        client.loop_start()
        log.info("MQTT subscriber started (pid=%d)", os.getpid())
    except Exception as e:
        log.error("MQTT connect failed: %s", e)


def get_db():
    return psycopg2.connect(**DB_CONFIG, cursor_factory=RealDictCursor)


def parse_iso(s):
    """Parse ISO timestamp, handling 'Z' suffix for Python < 3.11."""
    s = s.replace("Z", "+00:00")
    return datetime.fromisoformat(s)


# --- Static pages ---

@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/history")
def history():
    return send_from_directory("static", "history.html")


@app.route("/config.json")
def config():
    """Serve plant config (no credentials)."""
    static_config = {}
    config_path = os.path.join(app.static_folder, "config.json")
    if os.path.exists(config_path):
        with open(config_path) as f:
            static_config = json.load(f)
    return jsonify(static_config)


@app.route("/logo.svg")
def logo():
    return send_from_directory("static", "logo.svg")


# --- Music event log (circular buffer for analysis) ---

from collections import deque
_music_events = deque(maxlen=2000)
_music_events_lock = threading.Lock()
_signal_log = deque(maxlen=5000)
_signal_log_lock = threading.Lock()


@app.route("/api/music-log", methods=["POST"])
def music_log_post():
    """Receive note events from the web app."""
    events = request.get_json(silent=True)
    if events and isinstance(events, list):
        with _music_events_lock:
            for e in events:
                _music_events.append(e)
    return jsonify({"ok": True, "buffered": len(_music_events)})


@app.route("/api/music-log")
def music_log_get():
    """Query collected note events."""
    limit = int(request.args.get("limit", 200))
    with _music_events_lock:
        events = list(_music_events)[-limit:]
    return jsonify({"count": len(events), "events": events})


@app.route("/api/signal-log", methods=["POST"])
def signal_log_post():
    """Receive signal snapshots from the web app."""
    events = request.get_json(silent=True)
    if events and isinstance(events, list):
        with _signal_log_lock:
            for e in events:
                _signal_log.append(e)
    return jsonify({"ok": True, "buffered": len(_signal_log)})


@app.route("/api/signal-log")
def signal_log_get():
    """Get collected signal data."""
    limit = int(request.args.get("limit", 5000))
    with _signal_log_lock:
        events = list(_signal_log)[-limit:]
    return jsonify({"count": len(events), "events": events})


@app.route("/api/music-log/stats")
def music_log_stats():
    """Summary stats of collected note events."""
    with _music_events_lock:
        events = list(_music_events)
    if not events:
        return jsonify({"count": 0})

    from collections import Counter
    notes = Counter()
    sources = Counter()
    beat_positions = Counter()
    intervals = []
    last_t = None
    last_note = None

    for e in events:
        notes[e.get("note", "?")] += 1
        sources[e.get("src", "?")] += 1
        if "beat" in e:
            beat_positions[e["beat"]] += 1
        t = e.get("t", 0)
        if last_t:
            intervals.append(t - last_t)
        if last_note and e.get("note"):
            pass  # could compute pitch intervals
        last_t = t
        last_note = e.get("note")

    intervals.sort()
    n = len(intervals)
    return jsonify({
        "count": len(events),
        "notes": dict(notes.most_common(20)),
        "sources": dict(sources),
        "beat_positions": dict(sorted(beat_positions.items())),
        "timing": {
            "avg_ms": round(sum(intervals) / n, 1) if n else 0,
            "min_ms": round(intervals[0], 1) if n else 0,
            "max_ms": round(intervals[-1], 1) if n else 0,
            "median_ms": round(intervals[n // 2], 1) if n else 0,
        },
        "span_sec": round((events[-1].get("t", 0) - events[0].get("t", 0)) / 1000, 1) if len(events) > 1 else 0,
    })


# --- SSE stream ---

@app.route("/api/stream")
def stream():
    """Server-Sent Events endpoint — relays MQTT plant data to browsers."""
    _start_mqtt()

    def event_stream():
        q = Queue(maxsize=50)
        with _clients_lock:
            _clients.append(q)
        try:
            # Short queue timeout + heartbeat-as-data so client watchdog knows
            # the server is alive even when MQTT is quiet. Comment-based (:kp)
            # keepalives don't fire EventSource.onmessage, so the client's
            # stale watchdog would otherwise false-positive during quiet plant
            # periods.
            while True:
                try:
                    data = q.get(timeout=5)
                    yield f"data: {data}\n\n"
                except Empty:
                    yield f"data: {json.dumps({'hb': 1})}\n\n"
        except GeneratorExit:
            pass
        finally:
            with _clients_lock:
                if q in _clients:
                    _clients.remove(q)

    return Response(
        event_stream(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# --- API endpoints ---

@app.route("/api/range")
def data_range():
    """Get the available data time range."""
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT min(time) AS start, max(time) AS end, count(*) AS total_readings
                FROM plant_signals
            """)
            row = cur.fetchone()
            return jsonify({
                "start": row["start"].isoformat() if row["start"] else None,
                "end": row["end"].isoformat() if row["end"] else None,
                "total_readings": row["total_readings"],
            })


@app.route("/api/data")
def data():
    """Get signal data with automatic resolution based on time range.

    Query params:
        start: ISO timestamp (default: 1 hour ago)
        end: ISO timestamp (default: now)
        resolution: 'raw', '5s', '1min', '5min', '1hour' (default: auto)
    """
    now = datetime.now(timezone.utc)
    start = request.args.get("start", (now - timedelta(hours=1)).isoformat())
    end = request.args.get("end", now.isoformat())
    resolution = request.args.get("resolution", "auto")

    try:
        start_dt = parse_iso(start)
        end_dt = parse_iso(end)
    except ValueError:
        return jsonify({"error": "Invalid timestamp format"}), 400

    # Auto-select resolution based on time range
    span = end_dt - start_dt
    if resolution == "auto":
        if span <= timedelta(minutes=10):
            resolution = "raw"
        elif span <= timedelta(hours=1):
            resolution = "5s"
        elif span <= timedelta(hours=6):
            resolution = "1min"
        elif span <= timedelta(days=1):
            resolution = "5min"
        else:
            resolution = "1hour"

    with get_db() as conn:
        with conn.cursor() as cur:
            if resolution == "raw":
                cur.execute("""
                    SELECT time, voltage_mv
                    FROM plant_signals
                    WHERE time >= %s AND time <= %s
                    ORDER BY time
                """, (start_dt, end_dt))
            else:
                bucket = {
                    "5s": "5 seconds",
                    "1min": "1 minute",
                    "5min": "5 minutes",
                    "1hour": "1 hour",
                }.get(resolution, "1 minute")

                cur.execute("""
                    SELECT
                        time_bucket(%s, time) AS time,
                        avg(voltage_mv)::numeric(8,4) AS voltage_mv,
                        min(voltage_mv)::numeric(8,4) AS min_mv,
                        max(voltage_mv)::numeric(8,4) AS max_mv,
                        count(*) AS samples
                    FROM plant_signals
                    WHERE time >= %s AND time <= %s
                    GROUP BY 1
                    ORDER BY 1
                """, (bucket, start_dt, end_dt))

            rows = cur.fetchall()
            for row in rows:
                row["time"] = row["time"].isoformat()
                for key in row:
                    if key != "time" and row[key] is not None:
                        row[key] = float(row[key])

            return jsonify({
                "resolution": resolution,
                "count": len(rows),
                "start": start_dt.isoformat(),
                "end": end_dt.isoformat(),
                "data": rows,
            })


@app.route("/api/stats")
def stats():
    """Get summary statistics for a time range."""
    now = datetime.now(timezone.utc)
    start = request.args.get("start", (now - timedelta(hours=24)).isoformat())
    end = request.args.get("end", now.isoformat())

    try:
        start_dt = parse_iso(start)
        end_dt = parse_iso(end)
    except ValueError:
        return jsonify({"error": "Invalid timestamp format"}), 400

    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    count(*) AS readings,
                    avg(voltage_mv)::numeric(8,4) AS avg_mv,
                    min(voltage_mv)::numeric(8,4) AS min_mv,
                    max(voltage_mv)::numeric(8,4) AS max_mv,
                    stddev(voltage_mv)::numeric(8,4) AS stddev_mv,
                    percentile_cont(0.5) WITHIN GROUP (ORDER BY voltage_mv)::numeric(8,4) AS median_mv
                FROM plant_signals
                WHERE time >= %s AND time <= %s
            """, (start_dt, end_dt))
            row = cur.fetchone()
            for key in row:
                if row[key] is not None:
                    row[key] = float(row[key])
            return jsonify(row)


@app.route("/api/hourly")
def hourly():
    """Get hourly aggregates for the last N days."""
    days = int(request.args.get("days", 7))
    start = datetime.now(timezone.utc) - timedelta(days=days)

    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    time_bucket('1 hour', time) AS hour,
                    avg(voltage_mv)::numeric(8,4) AS avg_mv,
                    min(voltage_mv)::numeric(8,4) AS min_mv,
                    max(voltage_mv)::numeric(8,4) AS max_mv,
                    stddev(voltage_mv)::numeric(8,4) AS stddev_mv,
                    count(*) AS readings
                FROM plant_signals
                WHERE time >= %s
                GROUP BY 1
                ORDER BY 1
            """, (start,))
            rows = cur.fetchall()
            for row in rows:
                row["hour"] = row["hour"].isoformat()
                for key in row:
                    if key != "hour" and row[key] is not None:
                        row[key] = float(row[key])
            return jsonify(rows)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8286, debug=True)
