#!/bin/bash

# Change to the contracts directory
cd "$(dirname "$0")"

echo "Checking gates for each JSON file:"
echo "====================================="

# Iterate over all JSON files in noir/target directory
for json_file in noir/target/*.json; do
  if [ -f "$json_file" ]; then
    # Extract filename without path and extension
    filename=$(basename "$json_file" .json)

    # Run bb gates -b command and capture output
    output=$(bb gates -b "$json_file" 2>/dev/null)

    # Extract the JSON output (everything after the first {)
    json_output=$(echo "$output" | sed -n '/^{/,/^}/p' | tr '\n' ' ' | sed 's/ *$//')

    if [ -n "$json_output" ]; then
      # Extract circuit_size using jq if available, otherwise use grep/sed
      if command -v jq &>/dev/null; then
        circuit_size=$(echo "$json_output" | jq -r '.functions[0].circuit_size // "N/A"')
      else
        # Fallback to grep/sed if jq is not available
        circuit_size=$(echo "$json_output" | grep -o '"circuit_size":[0-9]*' | sed 's/"circuit_size"://')
        if [ -z "$circuit_size" ]; then
          circuit_size="N/A"
        fi
      fi

      echo "$filename: $circuit_size gates"
    else
      echo "$filename: No JSON output found"
    fi
  fi
done

echo "Done!"
