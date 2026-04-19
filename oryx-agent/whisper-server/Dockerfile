FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    git \
    curl \
    ca-certificates \
    ffmpeg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /opt

# Build whisper.cpp server (CPU)
RUN git clone --depth 1 https://github.com/ggerganov/whisper.cpp.git
WORKDIR /opt/whisper.cpp
RUN cmake -B build -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON \
 && cmake --build build -j

# Download a small English model for testing (base.en)
RUN mkdir -p /models \
 && curl -L -o /models/ggml-base.en.bin \
    https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin

EXPOSE 9000

CMD ["/opt/whisper.cpp/build/bin/whisper-server", \
  "--host", "0.0.0.0", \
  "--port", "9000", \
  "--inference-path", "/inference", \
  "--convert", \
  "--language", "en", \
  "--model", "/models/ggml-base.en.bin", \
  "--threads", "4" \
]

