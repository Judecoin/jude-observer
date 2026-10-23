# Jude Observer OMG block explorer

Block explorer using the Jude RPC interface to display blocks, transactions, and service nodes from a Judecoin node.

## Prerequisite packages

```sh
sudo apt install build-essential pkg-config libsodium-dev libzmq3-dev python3-dev python3-venv python3-flask
```

## Run mode

The explorer needs a synchronized Judecoin node with local LMQ RPC enabled. For a local IPC socket:

```sh
./juded --lmq-local-control ipc:///tmp/lmq.sock
```

Do not use `--no-sync` for a live explorer: it prevents the node from following the chain.

## Activate virtual environment

```sh
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements/dev.txt
```

The Python environment must also have the node's messaging binding available to connect to a real node. `MOCK_MODE=1` uses sample data and is only for local development and tests.

## Running in debug mode

Point the explorer at the local node before starting Flask. The debug server is for development; production requires a WSGI server.

```sh
export JUDE_RPC_ADDRESS=ipc:///tmp/lmq.sock
FLASK_APP=mainnet flask run --reload --debugger
```

For production, configure the WSGI server to load `mainnet:app` with `JUDE_RPC_ADDRESS` set to the local node's LMQ RPC address. Keep that node synchronized so the explorer reflects current chain data.
