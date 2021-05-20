#!/bin/bash

if [[ -z "$(git status --porcelain)" ]]; then
  echo "Git looks clean, you're good to go" > /dev/stderr
else
  git status
  git diff
  echo "ERROR: Git looks dirty, see above. Check in all changes." > /dev/stderr
  exit 2
fi
