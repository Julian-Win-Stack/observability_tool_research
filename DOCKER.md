# Docker Setup

## For you (building and publishing the image)

### 1. Build the image

Run this from the project root. No API keys needed at build time.

```bash
docker build -t observability-research .
```

### 2. Push to Docker Hub (optional, for colleagues to pull)

1. Create a free account at [hub.docker.com](https://hub.docker.com)
2. Log in: `docker login`
3. Tag and push:

```bash
docker tag observability-research YOUR_DOCKERHUB_USERNAME/observability-research
docker push YOUR_DOCKERHUB_USERNAME/observability-research
```

### 3. Create and share the .env file with colleagues

Create a `.env` file with these variables (use your actual keys):

```
AZURE_OPENAI_API_KEY=your-azure-key
AZURE_OPENAI_BASE_URL=https://bacca-us-east2.openai.azure.com/openai/v1
SEARCHAPI_API_KEY=your-searchapi-key
```

Send this file to your colleagues via a secure channel (e.g. encrypted message, password-protected zip). Do not commit it to Git or share it publicly.

### 4. Or share the image file directly

If you don't want to use Docker Hub:

```bash
docker save observability-research -o observability-research.tar
# Send observability-research.tar to your colleagues (e.g. via shared drive)
```

---

## For your colleagues (running the app)

**Prerequisites:**
1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/)
2. Have the `.env` file you sent them saved in a folder (e.g. their desktop or Downloads)

### If using Docker Hub

1. Open a terminal.
2. `cd` to the folder where the `.env` file is saved.
3. Run:

```bash
docker run --env-file .env -p 3000:3000 YOUR_DOCKERHUB_USERNAME/observability-research
```

4. Open **http://localhost:3000** in a browser.

### If using the image file you sent

1. Load the image: `docker load -i observability-research.tar`
2. `cd` to the folder where the `.env` file is saved.
3. Run: `docker run --env-file .env -p 3000:3000 observability-research`
4. Open **http://localhost:3000** in a browser.

---

## Stopping the app

Press `Ctrl+C` in the terminal, or close the terminal window.
