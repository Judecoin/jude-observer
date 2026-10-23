from observer import config
import pyjudemq as judemq

# Local settings.  Changes to this file are meant for a local installation (and should not be
# committed to git).

# Example config override:
#config.blocks_per_page = 10

config.juded_rpc = judemq.Address('ipc:///tmp/lmq.sock')
