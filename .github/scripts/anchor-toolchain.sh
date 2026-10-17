#!/usr/bin/env bash
set -euo pipefail

if ! command -v rustup >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs | sh -s -- -y --default-toolchain 1.99.1 --profile minimal --component rustfmt,clippy
fi
# shellcheck disable=SC1090
source "$HOME/.cargo/env"
rustup toolchain install 1.99.1 --profile minimal --component rustfmt,clippy
rustup default 1.99.1

if ! command -v solana >/dev/null 2>&1; then
  curl -fsSL https://release.anza.xyz/v4.3.2/install | sh
fi

mkdir -p "$HOME/.local/bin"
if [[ ! -x "$HOME/.local/bin/anchor" ]]; then
  curl -fsSL -o "$HOME/.local/bin/anchor" \
    https://github.com/solana-foundation/anchor/releases/download/v1.2.1/anchor-1.2.1-x86_64-unknown-linux-gnu
  chmod +x "$HOME/.local/bin/anchor"
fi

export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.local/bin:$PATH"
rustc --version
solana --version
anchor --version
