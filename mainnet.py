from observer import app, config
import judemq

config.juded_rpc = judemq.Address('ipc://juded/mainnet.sock')
