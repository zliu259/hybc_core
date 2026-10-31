"""/api/* 中继转发头的可信中转令牌注入。

Worker 侧只有看到与 RELAY_TRUST_TOKEN 相等的 X-Relay-Auth 才会采信 X-Forwarded-For 首跳作客户端 IP，
否则全体经 bridge 的小程序用户会共用 bridge 一个 IP 的限流额度。
"""

from app import main

TOKEN = "0123456789abcdef0123456789abcdef"


def test_injects_relay_auth_and_drops_client_value(monkeypatch):
    monkeypatch.setattr(main.settings, "relay_trust_token", TOKEN)
    out = main._filter_request_headers(
        {"X-Relay-Auth": "forged", "Authorization": "Bearer t", "Host": "x"}
    )
    assert out["X-Relay-Auth"] == TOKEN
    assert out["Authorization"] == "Bearer t"
    assert "Host" not in out


def test_no_token_means_no_header(monkeypatch):
    monkeypatch.setattr(main.settings, "relay_trust_token", "")
    out = main._filter_request_headers({"X-Relay-Auth": "forged"})
    assert "X-Relay-Auth" not in out
    assert "x-relay-auth" not in {k.lower() for k in out}


def test_placeholder_token_is_ignored(monkeypatch):
    monkeypatch.setattr(main.settings, "relay_trust_token", "replace-me")
    assert "X-Relay-Auth" not in main._filter_request_headers({})


def test_short_token_is_ignored(monkeypatch):
    monkeypatch.setattr(main.settings, "relay_trust_token", "short")
    assert "X-Relay-Auth" not in main._filter_request_headers({})
