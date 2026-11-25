#!/bin/sh
# Stands in for the provider CLI it is linked as (health-records/v1, as medrec's
# data contract has one): it signs in to nothing, reaches no network, and
# answers from the files beside it. scripts/demo-folder.mjs puts them there
# before each load.
d="$(dirname "$0")/../served/$(basename "$0")"
patient=''
profile=''
prev=''
for a in "$@"; do
  [ "$prev" = --patient ] && patient="$a"
  [ "$prev" = --profile ] && profile="$a"
  prev="$a"
done
case "$1 $2" in
  'info --json') cat "$d/info.json" ;;
  'profiles list') cat "$d/profiles.json" ;;
  'auth status') cat "$d/auth-$profile.json" ;;
  'records export')
    if [ -f "$d/$patient.exit" ]; then
      cat "$d/$patient.failure" >&2
      exit "$(cat "$d/$patient.exit")"
    fi
    cat "$d/$patient.ndjson" ;;
  *) echo "nothing stands in for: $*" >&2; exit 2 ;;
esac
