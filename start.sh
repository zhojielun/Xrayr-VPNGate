#!/bin/bash
cd /root/vpngate-panel
exec python3 server.py "$@"
