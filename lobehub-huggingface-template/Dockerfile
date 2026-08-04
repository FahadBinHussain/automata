ARG LOBEHUB_IMAGE=lobehub/lobehub:2.2.10
FROM ${LOBEHUB_IMAGE}

# LobeHub's official image listens on 3210. Hugging Face routes this through
# the Space card's app_port metadata, so the upstream entrypoint stays intact.
ENV HOSTNAME=0.0.0.0

EXPOSE 3210