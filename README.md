# Jude Observer OMG block explorer

Block explorer using Jude  RPC interface that does everything through RPC requests.  Sexy,
awesome, safe.

## Prerequisite packages 

    sudo apt install build-essential pkg-config libsodium-dev libzmq3-dev python3-dev python3-flask

## Run mode

    ./juded  --no-sync --lmq-local-control ipc:///tmp/lmq.sock   

## Activate virtual environment

     source .venv/bin/activate
   
## Running in debug mode

To run it in debug mode (production requires setting up a WSGI server, see below):

    FLASK_APP=observer flask run --reload --debugger
