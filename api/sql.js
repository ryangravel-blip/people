// Vercel serverless function that proxies SQL to Snowflake using key-pair (JWT) auth.
// Same pattern as mrp_reports/api/sql.ts — plain JS here since this repo has no build step.
//
// Required environment variables (set these in the Vercel project settings, NOT in code):
//   SNOWFLAKE_ACCOUNT       e.g. ABC12345.us-east-1
//   SNOWFLAKE_USERNAME
//   SNOWFLAKE_WAREHOUSE
//   SNOWFLAKE_DATABASE      defaults to "load" if unset
//   SNOWFLAKE_ROLE
//   SNOWFLAKE_PRIVATE_KEY   the PEM private key, with literal "\n" for newlines
//
// Do not commit the private key file itself to this repo. Paste its contents into the
// Vercel env var instead (Project Settings -> Environment Variables).

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

function buildJWT(account, username, privateKeyPem) {
  const acc = account.toUpperCase();
  const usr = username.toUpperCase();

  const publicKey = crypto.createPublicKey(privateKeyPem);
  const pubDer = publicKey.export({ type: 'spki', format: 'der' });
  const fingerprint = 'SHA256:' + crypto.createHash('sha256').update(pubDer).digest('base64');

  const iss = `${acc}.${usr}.${fingerprint}`;
  const sub = `${acc}.${usr}`;

  return jwt.sign({ sub }, privateKeyPem, {
    algorithm: 'RS256',
    issuer: iss,
    expiresIn: '59m',
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { sql } = req.body || {};
  if (!sql) return res.status(400).json({ error: 'Missing sql' });

  const account = process.env.SNOWFLAKE_ACCOUNT;
  const username = process.env.SNOWFLAKE_USERNAME;
  const warehouse = process.env.SNOWFLAKE_WAREHOUSE;
  const database = process.env.SNOWFLAKE_DATABASE || 'load';
  const role = process.env.SNOWFLAKE_ROLE;
  const privateKeyPem = (process.env.SNOWFLAKE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  let token;
  try {
    token = buildJWT(account, username, privateKeyPem);
  } catch (e) {
    return res.status(500).json({ error: `JWT build failed: ${e.message}` });
  }

  const url = `https://${account.toLowerCase()}.snowflakecomputing.com/api/v2/statements?requestId=${crypto.randomUUID()}`;

  let sfRes;
  try {
    sfRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Snowflake-Authorization-Token-Type': 'KEYPAIR_JWT',
      },
      body: JSON.stringify({ statement: sql, warehouse, database, role, timeout: 60 }),
    });
  } catch (e) {
    return res.status(502).json({ error: `Network error: ${e.message}` });
  }

  if (!sfRes.ok) {
    const errText = await sfRes.text();
    return res.status(sfRes.status).json({ error: errText.slice(0, 500) });
  }

  const body = await sfRes.json();

  const cols = (body.resultSetMetaData && body.resultSetMetaData.rowType || []).map(c => c.name);
  const rows = (body.data || []).map(row => {
    const obj = {};
    cols.forEach((col, i) => { obj[col] = row[i]; });
    return obj;
  });

  return res.json(rows);
};
