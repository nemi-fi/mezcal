#!/bin/bash

declare -A TIMERS

timeStart() {
    TIMERS["$1"]=$(date +%s)  # Use seconds instead
}

timeEnd() {
    local start=${TIMERS["$1"]}
    if [[ -z "$start" ]]; then
        echo "Timer '$1' not found"
        return 1
    fi
    local end=$(date +%s)
    local duration=$(( end - start ))
    echo "$1 took ${duration}s"
    unset TIMERS["$1"]
}
