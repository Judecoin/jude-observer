from observer import app, config
import pyjudemq as judemq


config.juded_rpc = judemq.Address('ipc://juded/testnet.sock')
