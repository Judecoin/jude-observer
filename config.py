# Default configuration options for block observer.
#
# To override settings add `config.whatever = ...` into `local_config.py`; adding settings *here*
# will often cause git conflicts.
#
# To override things that are specific to mainnet/testnet/etc. add `config.whatever = ...` lines
# into `mainnet.py`/`testnet.py`/etc.


# Local Judecoin node's LMQ RPC address, set by the entry point at runtime.
node_rpc = None

# Default blocks per page for the index.
blocks_per_page=20
# Maximum blocks per page a user can request
max_blocks_per_page=100

# Some display and/or feature options:
pusher=False
key_image_checker=False
output_key_checker=False
autorefresh_option=False
enable_mixins_details=True

# Jude only runs mainnet — no stagenet/testnet/devnet explorers
mainnet_url=None
testnet_url=None
devnet_url=None
stagenet_url=None
