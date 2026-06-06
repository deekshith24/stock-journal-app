const express = require('express');
// Use global fetch (Node 18+). If running on older Node, install a fetch polyfill.
const fetch = globalThis.fetch;

const app = express();
app.use(express.json());

app.get('/', (req, res) => res.send({ok:true, service: 'hf-proxy'}));

app.post('/infer', async (req, res) => {
  try {
    const { model = 'google/flan-t5-small', inputs } = req.body || {};
    if (!inputs) return res.status(400).json({ error: 'missing inputs in body' });

    const url = `https://api-inference.huggingface.co/models/${model}`;
    const token = process.env.HF_API_TOKEN;
    if (!token) return res.status(500).json({ error: 'HF_API_TOKEN not configured on proxy' });

    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ inputs })
    });

    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return res.status(r.status).send(data);
  } catch (err) {
    console.error('proxy error', err);
    res.status(500).json({ error: 'proxy error', details: String(err) });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`hf-proxy listening on ${port}`));
