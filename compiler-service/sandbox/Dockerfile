# Docker sandbox image for FCF C code execution
FROM alpine:latest

# Install gcc, musl-dev (standard C library headers), and basic runtime
RUN apk add --no-cache gcc musl-dev

# Create non-root execution user
RUN addgroup -g 1001 sandbox && \
    adduser -u 1001 -G sandbox -s /bin/sh -D sandbox

USER sandbox

