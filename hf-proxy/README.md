hf-proxy
========

A tiny proxy that forwards POST /infer to the Hugging Face Inference API using the proxy's `HF_API_TOKEN`.

Usage

Start locally:

```bash
cd hf-proxy
npm install
HF_API_TOKEN=<<your_hf_token>> npm start
```

Request shape:

POST /infer
Content-Type: application/json
Body: { "model": "google/flan-t5-small", "inputs": "Your input text" }

Response: proxied Hugging Face response (JSON)

Deploy on Render

- Use the existing `render.yaml` included at project root. It already contains a `hf-proxy` web service entry.
- Set the `HF_API_TOKEN` environment variable in Render for the `hf-proxy` service.
- After deploy, set `HF_PROXY_URL` in your `stock-journal-api` service to the proxy URL.
