import config
import json
import sys
import os
from datetime import datetime, timedelta

MOCK_MODE = os.environ.get('MOCK_MODE', '1') == '1'

if MOCK_MODE:
    from mock_data import MOCK_RESPONSES

    omq, oxend = 'mock_omq', 'mock_oxend'

    def omq_connection():
        return (omq, oxend)

    class FutureJSON():
        def __init__(self, omq, oxend, endpoint, cache_seconds=3, *, cache_key='', args=None, fail_okay=False, timeout=10):
            self.endpoint = endpoint
            self.args = args or {}
            self.fail_okay = fail_okay

        def get(self):
            base_endpoint = self.endpoint
            if base_endpoint in MOCK_RESPONSES:
                fn = MOCK_RESPONSES[base_endpoint]
                import inspect
                sig = inspect.signature(fn)
                if sig.parameters:
                    filtered = {k: v for k, v in self.args.items() if k in sig.parameters or
                                any(p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values())}
                    return fn(**filtered)
                return fn()
            if not self.fail_okay:
                print("Mock: no data for endpoint {}".format(self.endpoint), file=sys.stderr)
            return None

else:
    import oxenmq

    omq, oxend = None, None
    def omq_connection():
        global omq, oxend
        if omq is None:
            omq = oxenmq.OxenMQ(log_level=oxenmq.LogLevel.warn)
            omq.max_message_size = 200*1024*1024
            omq.start()
        if oxend is None:
            oxend = omq.connect_remote(config.oxend_rpc)
        return (omq, oxend)

    cached = {}
    cached_args = {}
    cache_expiry = {}

    class FutureJSON():
        """Class for making a LMQ JSON RPC request that uses a future to wait on the result, and caches
        the results for a set amount of time so that if the same endpoint with the same arguments is
        requested again the cache will be used instead of repeating the request."""

        def __init__(self, omq, oxend, endpoint, cache_seconds=3, *, cache_key='', args=None, fail_okay=False, timeout=10):
            self.endpoint = endpoint
            self.cache_key = self.endpoint + cache_key
            self.fail_okay = fail_okay
            if args is not None:
                args = json.dumps(args).encode()
            if self.cache_key in cached and cached_args[self.cache_key] == args and cache_expiry[self.cache_key] >= datetime.now():
                self.json = cached[self.cache_key]
                self.args = None
                self.future = None
            else:
                self.json = None
                self.args = args
                self.future = omq.request_future(oxend, self.endpoint, [] if self.args is None else [self.args], timeout=timeout)
            self.cache_seconds = cache_seconds

        def get(self):
            if self.json is None and self.future is not None:
                try:
                    result = self.future.get()
                    self.future = None
                    if result[0] != b'200':
                        raise RuntimeError("Request for {} failed: got {}".format(self.endpoint, result))
                    self.json = json.loads(result[1])
                    if self.cache_seconds is not None:
                        cached[self.cache_key] = self.json
                        cached_args[self.cache_key] = self.args
                        cache_expiry[self.cache_key] = datetime.now() + timedelta(seconds=self.cache_seconds)
                except RuntimeError as e:
                    if not self.fail_okay:
                        print("Something getting wrong: {}".format(e), file=sys.stderr)
                    self.future = None

            return self.json
