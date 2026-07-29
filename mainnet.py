from observer import app, config
import oxenmq

config.oxend_rpc = oxenmq.Address('ipc:///var/lib/judecoin/judecoind.sock')
