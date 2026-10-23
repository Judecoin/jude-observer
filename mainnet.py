from observer import app, config
import oxenmq
import os

rpc_address = os.environ.get('JUDE_RPC_ADDRESS')
if not rpc_address:
    raise RuntimeError('JUDE_RPC_ADDRESS must point to the local Judecoin node')
config.node_rpc = oxenmq.Address(rpc_address)
