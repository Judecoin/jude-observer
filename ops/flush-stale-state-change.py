#!/usr/bin/env python3
"""
清理 judecoind mempool 里过期的 state_change (type=1) 交易。

背景：state_change（Decommission/Deregistration 投票）交易只有约 60 块
（~2 小时）的有效窗口。如果对应服务节点在投票被打包前恢复正常，或仲裁
组没凑齐票数，这笔投票 tx 会永远卡在本地 mempool 里——judecoind 不会
自动过期它，导致 explorer 的 Transaction Pool 显示假的"待降级"条目。

策略：扫描 mempool，把 type=1、fee=0、age > 2h 的 tx 通过 admin RPC
的 flush_txpool 清掉。走 systemd timer 每小时触发一次。
"""
import json
import sys
import time
import urllib.request

ADMIN_RPC = "http://127.0.0.1:16063"
STALE_AFTER_SECONDS = 7200


def rpc_post(path, payload=None):
    data = json.dumps(payload).encode() if payload else None
    req = urllib.request.Request(
        ADMIN_RPC + path,
        data=data,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


def stamp():
    return time.strftime("%Y-%m-%d %H:%M:%S")


def main():
    now = int(time.time())
    pool = rpc_post("/get_transaction_pool")

    stale = []
    for tx in pool.get("transactions", []):
        try:
            inner = json.loads(tx["tx_json"])
        except (KeyError, ValueError):
            continue
        if inner.get("type") != 1 or tx.get("fee", 0) != 0:
            continue
        age = now - tx.get("receive_time", now)
        if age < STALE_AFTER_SECONDS:
            continue
        stale.append((tx["id_hash"], age))

    if not stale:
        print(f"[{stamp()}] no stale state_change txs")
        return

    hashes = [h for h, _ in stale]
    result = rpc_post("/json_rpc", {
        "jsonrpc": "2.0",
        "id": "0",
        "method": "flush_txpool",
        "params": {"txids": hashes},
    })
    status = result.get("result", {}).get("status", "?")
    for h, age in stale:
        print(f"[{stamp()}] flushed state_change {h} (age {age // 3600}h): {status}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"[{stamp()}] error: {e}", file=sys.stderr)
        sys.exit(1)
