# Jobs Attachment Uploader

An Airtable extension + Vercel API that lets you upload files straight into the
**Invoice PDF**, **Packing Slip**, and **Attachments** fields on a selected
**Jobs** record.

- **Frontend:** an Airtable Blocks SDK extension (`extension/`) that reads the
  active Jobs record, shows three upload buttons, and base64-encodes the picked
  files.
- **API:** a Vercel serverless function (`api/upload.js`) that holds the
  Airtable token and appends each file to the right attachment field via
  Airtable's native `uploadAttachment` content endpoint.

```
Airtable extension  ──POST /api/upload──▶  Vercel function  ──uploadAttachment──▶  Airtable
 (base64 the file)      {recordId,             (holds the PAT)        (file appended to field)
                         target, files}
```

Why a server hop at all: the Blocks SDK can't push a local file into an
attachment field directly (it only accepts attachment objects that already have
a URL). The Vercel function uses the `uploadAttachment` endpoint, which takes the
file's base64 bytes directly — no public file hosting needed.

| Base | `appMMGRranZOTCyiX` |
| Table | Jobs (`tblScx0Dj8Gu74sSG`) |
| Invoice PDF | `fldy5GeijwdnjtMAt` |
| Packing Slip | `fldspmJ63di7l2JM4` |
| Attachments | `fldnzMPnq4E6lFUL7` |

**Limit:** 5 MB per file (an Airtable `uploadAttachment` constraint). Enforced on
both the client and server.

---

## Part 1 — Deploy the API to Vercel

1. Push this repo to GitHub.
2. In Vercel, **Add New… → Project**, import the repo, and deploy. No build
   command or framework preset is needed — Vercel auto-detects `api/upload.js`
   as a serverless function.
3. Add **Environment Variables** (Settings → Environment Variables). See
   `.env.example`:
   - `AIRTABLE_PAT` *(required)* — a personal access token from
     <https://airtable.com/create/tokens> with scope **`data.records:write`** and
     access to the Jobs base.
   - `AIRTABLE_BASE_ID` *(optional)* — defaults to `appMMGRranZOTCyiX`.
   - `UPLOAD_SECRET` *(optional)* — if set, the extension must send the same
     value (see the extension's Settings panel).
   - `ALLOWED_ORIGIN` *(optional)* — defaults to `*`. Can be locked to
     `https://*.airtableblocks.com`-style origins if desired.
4. Redeploy after adding env vars. Your endpoint is:
   `https://<your-project>.vercel.app/api/upload`

### Quick API test (without the extension)

```bash
curl -X POST https://<your-project>.vercel.app/api/upload \
  -H "Content-Type: application/json" \
  -d '{
    "recordId": "recXXXXXXXXXXXXXX",
    "target": "attachments",
    "files": [{ "filename": "hello.txt", "contentType": "text/plain", "data": "aGVsbG8=" }]
  }'
```

Expected: `{"ok":true,"recordId":"...","target":"attachments","uploaded":[{"filename":"hello.txt"}]}`
and the file appears in the Attachments field of that record.

---

## Part 2 — Install the Airtable extension

The extension lives in `extension/` and is built/installed with Airtable's
Blocks CLI (it is **not** deployed to Vercel).

1. Install the CLI once: `npm install -g @airtable/blocks-cli`
2. In Airtable, open the **Jobs** base → **Extensions** → **Add an extension** →
   **Build a custom extension**. Give it a name and choose "Hello world (JS)".
   Airtable shows you a `block init` command containing your block ID — copy it.
3. Initialize a local block with that command, then replace the generated
   `block.json`, `package.json`, and `frontend/index.js` with the files from this
   repo's `extension/` folder (they already contain the Jobs table and field
   ids).
4. From the extension folder run `block run`, then back in Airtable click
   **Edit extension** and paste the local server URL it prints. You'll see the
   three buttons live.
5. When you're happy, run `block release` to publish it to the base so others can
   use it without the dev server.

### Configure it

On first load the extension opens its **Settings** panel (also reachable via the
gear/settings button). Paste your deployed **Upload API URL**
(`https://<your-project>.vercel.app/api/upload`) and, if you set one, the
**Upload secret**. These are stored in the base's globalConfig, so every
collaborator shares the same configuration.

### Use it

Open the Jobs table, select a record, and the extension shows
**Add to Invoice PDF / Packing Slip / Attachments**. Click one, pick one or more
files, and they're appended to that field on the selected record. Existing
attachments are preserved (files are added, not replaced).

---

## Request / response reference

**POST `/api/upload`**

```json
{
  "recordId": "recXXXXXXXXXXXXXX",
  "target": "invoice | packing | attachments",
  "files": [
    { "filename": "x.pdf", "contentType": "application/pdf", "data": "<base64, no data: prefix>" }
  ]
}
```

| Status | Meaning |
| --- | --- |
| `200 {ok:true, uploaded:[...]}` | All files uploaded. |
| `207 {ok:false, uploaded, failed}` | Some files uploaded, some failed. |
| `400 {error}` | Bad input (missing/invalid recordId, target, files, or a file > 5 MB). |
| `401 {error}` | `UPLOAD_SECRET` is set and the header didn't match. |
| `502 {ok:false, failed}` | All files failed (e.g. bad record id or token). |
| `500 {error}` | Server misconfigured (missing `AIRTABLE_PAT`). |

---

## Security note

If `ALLOWED_ORIGIN` is `*` and `UPLOAD_SECRET` is unset, anyone who discovers the
endpoint URL could append files to records in the base. The `UPLOAD_SECRET` adds
light abuse-prevention, but because it ships inside client-side extension code it
isn't a true secret. For a hardened setup, restrict `ALLOWED_ORIGIN` and/or front
the endpoint with additional auth.
