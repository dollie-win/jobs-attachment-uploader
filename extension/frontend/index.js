import {
  initializeBlock,
  useBase,
  useCursor,
  useRecordById,
  useGlobalConfig,
  useLoadable,
  useWatchable,
  useSettingsButton,
  Box,
  Button,
  Heading,
  Text,
  Input,
  FormField,
  Loader,
} from "@airtable/blocks/ui";
import React, { useState, useRef } from "react";

// ---- Config -----------------------------------------------------------------

const JOBS_TABLE_ID = "tblScx0Dj8Gu74sSG";

// Each button maps to a `target` the API understands, which it resolves to the
// matching attachment field id server-side.
const TARGETS = [
  { key: "invoice", label: "Invoice PDF", fieldId: "fldy5GeijwdnjtMAt" },
  { key: "packing", label: "Packing Slip", fieldId: "fldspmJ63di7l2JM4" },
  { key: "attachments", label: "Attachments", fieldId: "fldnzMPnq4E6lFUL7" },
];

const MAX_FILE_BYTES = 5 * 1024 * 1024; // Airtable uploadAttachment per-file limit

// ---- Helpers ----------------------------------------------------------------

// Browser File -> bare base64 string (strips the "data:...;base64," prefix).
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// ---- Root -------------------------------------------------------------------

function App() {
  const base = useBase();
  const cursor = useCursor();
  const globalConfig = useGlobalConfig();

  useLoadable(cursor);
  useWatchable(cursor, ["selectedRecordIds", "activeTableId"]);

  const [showSettings, setShowSettings] = useState(false);
  useSettingsButton(() => setShowSettings((s) => !s));

  const apiUrl = globalConfig.get("apiUrl");
  const uploadSecret = globalConfig.get("uploadSecret");

  if (showSettings || !apiUrl) {
    return (
      <SettingsView
        globalConfig={globalConfig}
        apiUrl={apiUrl}
        uploadSecret={uploadSecret}
        canClose={Boolean(apiUrl)}
        onClose={() => setShowSettings(false)}
      />
    );
  }

  const jobsTable = base.getTableByIdIfExists(JOBS_TABLE_ID);
  if (!jobsTable) {
    return (
      <Frame>
        <Text textColor="light">
          The Jobs table was not found in this base. This extension is configured for table{" "}
          {JOBS_TABLE_ID}.
        </Text>
      </Frame>
    );
  }

  if (cursor.activeTableId !== JOBS_TABLE_ID) {
    return (
      <Frame>
        <Text>Open the <strong>Jobs</strong> table, then select a record to upload to.</Text>
      </Frame>
    );
  }

  const recordId = cursor.selectedRecordIds[0];
  if (!recordId) {
    return (
      <Frame>
        <Text>Select a Job record (click the row's expand handle or check the row) to begin.</Text>
      </Frame>
    );
  }

  return (
    <Uploader table={jobsTable} recordId={recordId} apiUrl={apiUrl} uploadSecret={uploadSecret} />
  );
}

// ---- Uploader ---------------------------------------------------------------

function Uploader({ table, recordId, apiUrl, uploadSecret }) {
  const record = useRecordById(table, recordId);
  const [busyKey, setBusyKey] = useState(null);
  const [status, setStatus] = useState(null); // { type: "success"|"error"|"info", msg }
  const inputRefs = useRef({});

  const jobName = record ? record.name : recordId;

  async function uploadFiles(targetKey, fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    // client-side size guard (mirrors the server)
    const tooBig = files.find((f) => f.size > MAX_FILE_BYTES);
    if (tooBig) {
      setStatus({
        type: "error",
        msg: `"${tooBig.name}" is larger than 5 MB. Airtable's upload limit is 5 MB per file.`,
      });
      return;
    }

    setBusyKey(targetKey);
    setStatus({ type: "info", msg: `Uploading ${files.length} file(s)...` });

    try {
      const encoded = await Promise.all(
        files.map(async (f) => ({
          filename: f.name,
          contentType: f.type || "application/octet-stream",
          data: await fileToBase64(f),
        }))
      );

      const headers = { "Content-Type": "application/json" };
      if (uploadSecret) headers["x-upload-secret"] = uploadSecret;

      const res = await fetch(apiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ recordId, target: targetKey, files: encoded }),
      });
      const json = await res.json().catch(() => ({}));

      if (res.ok && json.ok) {
        setStatus({
          type: "success",
          msg: `Uploaded ${json.uploaded.length} file(s) to ${labelFor(targetKey)}.`,
        });
      } else if (json && json.failed) {
        const okCount = (json.uploaded || []).length;
        setStatus({
          type: "error",
          msg: `${okCount} uploaded, ${json.failed.length} failed: ${
            json.failed.map((f) => f.filename).join(", ")
          }.`,
        });
      } else {
        setStatus({ type: "error", msg: json.error || `Upload failed (HTTP ${res.status}).` });
      }
    } catch (err) {
      setStatus({ type: "error", msg: `Upload error: ${String(err)}` });
    } finally {
      setBusyKey(null);
      // reset the input so picking the same file again re-fires onChange
      const el = inputRefs.current[targetKey];
      if (el) el.value = "";
    }
  }

  return (
    <Frame>
      <Heading size="small" marginBottom={1}>
        Upload to Job
      </Heading>
      <Text textColor="light" marginBottom={2}>
        {jobName}
      </Text>

      <Box display="flex" flexDirection="column" style={{ gap: 8 }}>
        {TARGETS.map((t) => (
          <Box key={t.key}>
            <input
              type="file"
              multiple
              ref={(el) => (inputRefs.current[t.key] = el)}
              style={{ display: "none" }}
              onChange={(e) => uploadFiles(t.key, e.target.files)}
            />
            <Button
              icon="upload"
              variant="default"
              width="100%"
              disabled={Boolean(busyKey)}
              onClick={() => inputRefs.current[t.key] && inputRefs.current[t.key].click()}
            >
              {busyKey === t.key ? "Uploading..." : `Add to ${t.label}`}
            </Button>
          </Box>
        ))}
      </Box>

      {busyKey && (
        <Box marginTop={2} display="flex" alignItems="center">
          <Loader scale={0.4} />
          <Text marginLeft={2} textColor="light">
            Working...
          </Text>
        </Box>
      )}

      {status && (
        <Box
          marginTop={2}
          padding={2}
          borderRadius={3}
          backgroundColor={
            status.type === "success"
              ? "greenLight2"
              : status.type === "error"
              ? "redLight2"
              : "grayLight2"
          }
        >
          <Text>{status.msg}</Text>
        </Box>
      )}
    </Frame>
  );
}

function labelFor(key) {
  const t = TARGETS.find((x) => x.key === key);
  return t ? t.label : key;
}

// ---- Settings ---------------------------------------------------------------

function SettingsView({ globalConfig, apiUrl, uploadSecret, canClose, onClose }) {
  const [url, setUrl] = useState(apiUrl || "");
  const [secret, setSecret] = useState(uploadSecret || "");
  const [saving, setSaving] = useState(false);
  const canEdit = globalConfig.hasPermissionToSet("apiUrl");

  async function save() {
    setSaving(true);
    try {
      await globalConfig.setAsync("apiUrl", url.trim());
      await globalConfig.setAsync("uploadSecret", secret.trim());
      if (canClose) onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Frame>
      <Heading size="small" marginBottom={2}>
        Settings
      </Heading>
      <FormField label="Upload API URL" description="Your deployed Vercel endpoint, e.g. https://your-project.vercel.app/api/upload">
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://...vercel.app/api/upload" />
      </FormField>
      <FormField
        label="Upload secret (optional)"
        description="Only needed if you set UPLOAD_SECRET on the server."
      >
        <Input value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="leave blank if unused" />
      </FormField>

      {!canEdit && (
        <Text textColor="red" marginBottom={2}>
          You do not have permission to change these settings in this base.
        </Text>
      )}

      <Box display="flex" style={{ gap: 8 }}>
        <Button variant="primary" disabled={!url.trim() || saving || !canEdit} onClick={save}>
          {saving ? "Saving..." : "Save"}
        </Button>
        {canClose && (
          <Button variant="default" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
        )}
      </Box>
    </Frame>
  );
}

// ---- Layout -----------------------------------------------------------------

function Frame({ children }) {
  return (
    <Box padding={3} style={{ maxWidth: 420 }}>
      {children}
    </Box>
  );
}

initializeBlock(() => <App />);
