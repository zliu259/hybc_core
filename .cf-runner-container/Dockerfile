FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY runner ./runner

EXPOSE 8080

CMD ["bash", "-lc", "python -m runner.main & python -m http.server 8080 --bind 0.0.0.0"]
