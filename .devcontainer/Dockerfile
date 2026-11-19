FROM ubuntu:24.04
RUN apt-get update && apt-get install -y --no-install-recommends \
      bash ca-certificates curl git python3 python3.12-venv zstd \
    && apt-get clean && rm -rf /var/lib/apt/lists/*
ARG USERNAME=studio
RUN useradd --create-home --shell /bin/bash "$USERNAME"
USER $USERNAME
