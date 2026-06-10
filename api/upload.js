// Vercel serverless function: POST /api/upload
//
// Appends one or more files to an attachment field on a Jobs record in
// Airtable, using Airtable's native "uploadAttachment" content endpoint
// (base64 in, no public file hosting required). Max 5 MB per file.
//
// Request body (JSON):
// {
//   "recordId": "recXXXXXXXXXXXXXX",          // a Jobs record id
//   "target":   "invoice" | "packing" | "attachments",
//   "files": [
//     { "filename": "x.pdf", "contentType": "application/pdf", "data": "<base64>" }
//   ]
// }
//
// Env vars (set in Vercel project settings):
//   AIRTABLE_PAT      (required) personal access token, scope data.records:write on the base
//   AIRTABLE_BASE_ID  (optional) defaults to the Jobs base below
//   UPLOAD_SECRET     (optional) if set, requests must send header  x-upload-secret: <value>
//   ALLOWED_ORIGIN    (optional) CORS origin; defaults to "*"

const DEFAULT_BASE_ID = "appMMGRranZOTCyiX";

// target -> attachment field id on the Jobs table (tblScx0Dj8Gu74sSG)
const FIELD_BY_TARGET = {
  invoice: "fldy5GeijwdnjtMAt", // Invoice PDF
  packing: "fldspmJ63di7l2JM4", // Packing Slip
  attachments: "fldnzMPnq4E6lFUL7", // Attachments
};

const MAX_FILE_BYTES = 5 * 1024 * 1024; // Airtable uploadAttachment limit

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-upload-secret");
}

// rough byte size of a base64 string (prefix already stripped client-side)
function base64Bytes(b64) {
  const len = b64.length;
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((len * 3) / 4) - padding;
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const pat = process.env.AIRTABLE_PAT;
  if (!pat) {
    return res.status(500).json({ error: "Server not configured: AIRTABLE_PAT is missing." });
  }

  // optional shared-secret gate
  if (process.env.UPLOAD_SECRET) {
    if (req.headers["x-upload-secret"] !== process.env.UPLOAD_SECRET) {
      return res.status(401).json({ error: "Unauthorized." });
    }
  }

  const baseId = process.env.AIRTABLE_BASE_ID || DEFAULT_BASE_ID;

  // body may arrive parsed (Vercel) or as a raw string
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: "Body is not valid JSON." });
    }
  }
  body = body || {};

  const { recordId, target, files } = body;

  if (!recordId || typeof recordId !== "string" || !recordId.startsWith("rec")) {
    return res.status(400).json({ error: "Missing or invalid 'recordId' (expected a recXXXX id)." });
  }
  const fieldId = FIELD_BY_TARGET[target];
  if (!fieldId) {
    return res.status(400).json({
      error: "Missing or invalid 'target'. Expected one of: invoice, packing, attachments.",
    });
  }
  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: "Missing 'files' (expected a non-empty array)." });
  }

  // validate each file up front
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (!f || typeof f.data !== "string" || !f.data) {
      return res.status(400).json({ error: `files[${i}] is missing base64 'data'.` });
    }
    if (!f.filename) {
      return res.status(400).json({ error: `files[${i}] is missing 'filename'.` });
    }
    if (base64Bytes(f.data) > MAX_FILE_BYTES) {
      return res.status(400).json({
        error: `files[${i}] ("${f.filename}") exceeds the 5 MB per-file limit.`,
      });
    }
  }

  const uploaded = [];
  const failed = [];

  // Airtable's uploadAttachment endpoint takes one file per call and APPENDS
  // it to the field, so we loop sequentially to preserve order.
  for (const f of files) {
    const url = `https://content.airtable.com/v0/${baseId}/${recordId}/${fieldId}/uploadAttachment`;
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${pat}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contentType: f.contentType || "application/octet-stream",
          filename: f.filename,
          file: f.data,
        }),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) {
        failed.push({ filename: f.filename, status: r.status, error: json.error || json });
      } else {
        uploaded.push({ filename: f.filename });
      }
    } catch (err) {
      failed.push({ filename: f.filename, error: String(err) });
    }
  }

  if (failed.length === 0) {
    return res.status(200).json({ ok: true, recordId, target, uploaded });
  }
  // partial result: some (207) or all (502) files failed
  return res.status(uploaded.length ? 207 : 502).json({
    ok: false,
    recordId,
    target,
    uploaded,
    failed,
  });
};
