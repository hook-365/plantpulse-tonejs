FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .
COPY static/ static/
COPY tools/simulate-signal tools/simulate-signal

EXPOSE 8286

CMD ["gunicorn", "--bind", "0.0.0.0:8286", "--worker-class", "gevent", "--workers", "2", "--timeout", "120", "server:app"]
