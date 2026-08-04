FROM python:3.11-slim

# 镜像版本标记：改 envVars（如 CAPABILITIES）不会产生新镜像，容器不会滚动重启、
# 新环境变量不生效；max_instances=1 又让"换 DO 名"的办法起不来（旧实例占名额）。
# 需要强制重启时 bump 此值即可触发镜像变更 → 滚动更新。
ARG RUNNER_ENV_REV=2

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY runner ./runner

EXPOSE 8080

CMD ["bash", "-lc", "python -m runner.main & python -m http.server 8080 --bind 0.0.0.0"]
