#!/usr/bin/env python3
"""PlantPulse History Viewer — local Flask API + static page server."""

import os
from datetime import datetime, timedelta
from flask import Flask, jsonify, request, send_from_directory
import psycopg2
from psycopg2.extras import RealDictCursor

app = Flask(__name__, static_folder=".", static_url_path="")

DB_CONFIG = {
    "host": os.environ.get("DB_HOST", "192.168.1.200"),
    "port": int(os.environ.get("DB_PORT", 5433)),
    "dbname": os.environ.get("DB_NAME", "plantpulse"),
    "user": os.environ.get("DB_USER", "plantpulse"),
    "password": os.environ.get("DB_PASS", "plantpulse"),
}


def get_db():
    return psycopg2.connect(**DB_CONFIG, cursor_factory=RealDictCursor)


@app.route("/")
def index():
    return send_from_directory(".", "index.html")


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
    now = datetime.now()
    start = request.args.get("start", (now - timedelta(hours=1)).isoformat())
    end = request.args.get("end", now.isoformat())
    resolution = request.args.get("resolution", "auto")

    # Parse timestamps
    try:
        start_dt = datetime.fromisoformat(start)
        end_dt = datetime.fromisoformat(end)
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

                cur.execute(f"""
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
            # Convert timestamps to ISO strings
            for row in rows:
                row["time"] = row["time"].isoformat()
                # Convert Decimal to float
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
    now = datetime.now()
    start = request.args.get("start", (now - timedelta(hours=24)).isoformat())
    end = request.args.get("end", now.isoformat())

    try:
        start_dt = datetime.fromisoformat(start)
        end_dt = datetime.fromisoformat(end)
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
    start = datetime.now() - timedelta(days=days)

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
    app.run(host="127.0.0.1", port=8287, debug=True)
