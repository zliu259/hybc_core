FROM python:3.11-slim

# 镜像版本标记：改 envVars（如 CAPABILITIES）不会产生新镜像，容器不会滚动重启、
# 新环境变量不生效；max_instances=1 又让"换 DO 名"的办法起不来（旧实例占名额）。
# 需要强制重启时 bump 此值即可触发镜像变更 → 滚动更新。
ARG RUNNER_ENV_REV=3

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY runner ./runner

EXPOSE 8080

# runner 必须是容器主进程：runner 一死（如 OOM）容器即退出，下一分钟 cron 唤醒时冷启动。
# 反过来让 http.server 当主进程，runner 死后容器仍 running、cron 唤醒照常 200、
# sleepAfter 永不到期 → 队列整体停摆且不自愈（2026-10-27 事故）。
CMD ["bash", "-lc", "python -m http.server 8080 --bind 0.0.0.0 & exec python -m runner.main"]
