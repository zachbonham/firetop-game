#!/bin/sh
# Container entrypoint. With a backup bucket configured (on Fly), Litestream runs the server as
# its child, streams every database change to the bucket and forwards stop signals to the server.
# Without one (e.g. a local `docker run`), the server runs on its own.
set -e

SERVER="node --enable-source-maps --disable-warning=ExperimentalWarning server.mjs"

if [ -n "$BUCKET_NAME" ]; then
  exec litestream replicate -config /etc/litestream.yml -exec "$SERVER"
fi
echo "BUCKET_NAME is not set: running without Litestream backups"
exec $SERVER
