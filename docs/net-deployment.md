# .net explorer deployment

The repository's `main` branch is the intended source for the `.net` explorer.
The live installation must be reconciled and verified against this branch
before it is replaced. Deploy against a synchronized, locally managed Judecoin
node. Keep the node's LMQ RPC
socket and the explorer's state file in server configuration; do not put host
addresses, credentials, or private filesystem paths in Git.

## Required runtime settings

- `MOCK_MODE=0` for production.
- `JUDE_RPC_ADDRESS` must point at the local node's LMQ RPC socket. The
  `mainnet:app` entry point refuses to start if this is absent.
- `JUDE_STAKE_INDEX_STATE` should point to a writable, persistent state file
  outside the application directory. Keep it across restarts and upgrades.
  The code falls back to a temporary system directory when unset.
- Keep the packaged `stake_index_seed.json` alongside `deregistered_nodes.py`.
  It contains public chain indexing data needed to match locked stake records
  to service nodes. A fresh node blacklist alone does not identify each node.

Use the existing production Python environment with the Judecoin messaging
binding installed. Its availability is separate from the development
dependencies in `requirements/dev.txt`.

## Before replacing a live installation

1. Verify the checkout's `main` commit and inspect the differences against the
   live source directory. Do not copy repository folders for other explorers.
2. Record the current service unit, Python environment, node socket settings,
   and SHA-256 checksums of the files being replaced. Keep any machine-specific
   `local_config.py` on the server only.
3. Back up the live source, service unit, and existing stake index state outside
   the installation directory. Confirm that the backup can be listed and read.
4. Arrange the production service environment so `JUDE_RPC_ADDRESS` and
   `JUDE_STAKE_INDEX_STATE` are set before starting `mainnet:app`. Verify that
   the socket is accessible from the service account.
5. Copy only the reviewed `.net` files. Preserve the Python environment,
   machine-specific configuration, service node database, and other explorer
   folders. Compile the Python sources with the production interpreter, then
   restart only the explorer service.
6. Check the service state and logs. Request the homepage, service node page,
   statistics, blocks, transactions, search, and the relevant JSON APIs.
   Compare the deregistered count against the local node's current blacklist
   and check that all three pages show the same value.

The live count is refreshed on page requests and is cached briefly in each web
worker. Pages already open in a browser need a refresh. When an active locked
stake cannot yet be mapped to a service node, the display says `Syncing` until
the chain index catches up; never substitute a historical event total.

## Recovery

Restore the backed-up files and service settings, restart the explorer service,
and verify its homepage. Do not delete the index state or node database while
recovering. The historical deregistration cache from older deployments is not
used by the current count.
