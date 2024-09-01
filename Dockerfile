FROM oven/bun:latest
WORKDIR /src
COPY ./ ./
RUN bun install
EXPOSE 3000
CMD ["bun", "run", "start"]