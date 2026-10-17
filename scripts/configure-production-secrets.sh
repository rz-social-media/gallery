#!/bin/zsh
set -e

repository="rz-social-media/gallery"
secret_names=(
  CLOUDFLARE_API_TOKEN
  CLOUDFLARE_ACCOUNT_ID
  R2_ACCESS_KEY_ID
  R2_SECRET_ACCESS_KEY
  MUX_TOKEN_ID
  MUX_TOKEN_SECRET
)

echo "Saving production secrets to $repository"
echo "Input is hidden. Paste each value and press Enter."

for secret_name in $secret_names; do
  printf "\n%s: " "$secret_name"
  IFS= read -rs secret_value
  printf "\n"
  if [[ -z "$secret_value" ]]; then
    echo "$secret_name cannot be empty. Nothing else was changed."
    exit 1
  fi
  printf '%s' "$secret_value" | gh secret set "$secret_name" --repo "$repository"
  unset secret_value
  echo "Saved $secret_name"
done

echo "\nAll required secrets are configured:"
gh secret list --repo "$repository"
