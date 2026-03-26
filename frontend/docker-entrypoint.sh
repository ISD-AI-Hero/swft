#!/bin/sh
##
# Entrypoint for the SWFT frontend container.
# Processes the nginx.conf template with envsubst so that the
# API_BACKEND_URL environment variable is resolved at container
# startup time (not at image build time).
##
set -e

# Only substitute our explicit variable — avoid clobbering nginx's
# own $uri, $host, $proxy_host, etc.
envsubst '${API_BACKEND_URL}' \
  < /etc/nginx/templates/default.conf.template \
  > /etc/nginx/conf.d/default.conf

echo "SWFT frontend starting — API proxy target: ${API_BACKEND_URL}"

exec nginx -g 'daemon off;'
