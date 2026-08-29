# Cotaska R2 upload script
# Uploads the current NSIS release assets to the R2 latest/ prefix only.

param(
    [string]$ConfigPath = "config\r2-upload.local.json"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir "..")).Path
. (Join-Path $scriptDir "scripts\release-common.ps1")
$releaseArtifacts = Assert-CotaskaInstallerReleaseArtifacts -AppDir $scriptDir
$gitCommit = Get-CotaskaGitCommit -RepoRoot $repoRoot
$nodeFromRepo = Join-Path $repoRoot "v22.14.0\node.exe"
$nodeExe = if (Test-Path -LiteralPath $nodeFromRepo) { $nodeFromRepo } else { "node" }
$resolvedConfigPath = if ([System.IO.Path]::IsPathRooted($ConfigPath)) {
    $ConfigPath
} else {
    Join-Path $scriptDir $ConfigPath
}

if (-not (Test-Path -LiteralPath $resolvedConfigPath)) {
    Write-Host "[FAILED] R2 config not found: $resolvedConfigPath" -ForegroundColor Red
    exit 1
}

$nodeScript = @'
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

const scriptDir = process.argv[2];
const configPath = process.argv[3];
const version = process.argv[4];
const gitCommit = process.argv[5];
const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));

function required(name, value) {
  if (!value || typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} is missing in ${configPath}`);
  }
}

required('accountId', cfg.accountId);
required('accessKeyId', cfg.accessKeyId);
required('secretAccessKey', cfg.secretAccessKey);
required('bucket', cfg.bucket);
required('s3Endpoint', cfg.s3Endpoint);
required('publicBaseUrl', cfg.publicBaseUrl);

const latestPrefix = ((cfg.uploadTargets && cfg.uploadTargets.latestPrefix) || 'latest').replace(/^\/+|\/+$/g, '');
const releaseDir = path.join(scriptDir, 'release');
const releasedAt = new Date().toISOString();
const installerName = `Cotaska-${version}-win-x64.exe`;
const blockmapName = `${installerName}.blockmap`;

const assets = [
  {
    source: path.join(releaseDir, installerName),
    key: `${latestPrefix}/${installerName}`,
    contentType: 'application/vnd.microsoft.portable-executable'
  },
  {
    source: path.join(releaseDir, blockmapName),
    key: `${latestPrefix}/${blockmapName}`,
    contentType: 'application/octet-stream'
  },
  {
    source: path.join(releaseDir, 'latest.yml'),
    key: `${latestPrefix}/latest.yml`,
    contentType: 'text/yaml; charset=utf-8'
  }
];

for (const asset of assets) {
  if (!fs.existsSync(asset.source)) {
    throw new Error(`Release asset not found: ${asset.source}`);
  }
}

const versionJson = {
  version,
  gitCommit,
  releasedAt,
  channel: 'nsis',
  releaseUrl: `${cfg.publicBaseUrl.replace(/\/$/, '')}/${latestPrefix}/${installerName}`,
  files: {
    installer: installerName,
    blockmap: blockmapName,
    updateMetadata: 'latest.yml'
  }
};

assets.push({
  source: null,
  body: Buffer.from(JSON.stringify(versionJson, null, 2) + '\n', 'utf8'),
  key: `${latestPrefix}/version.json`,
  contentType: 'application/json; charset=utf-8'
});

const endpoint = new URL(cfg.s3Endpoint);
const host = endpoint.host;
const region = 'auto';
const service = 's3';

function hmac(key, data, encoding) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest(encoding);
}

function sha256(data, encoding = 'hex') {
  return crypto.createHash('sha256').update(data).digest(encoding);
}

function amzDate(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function dateStamp(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function encodePathPart(part) {
  return encodeURIComponent(part).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function canonicalUri(bucket, key) {
  return '/' + [bucket, ...key.split('/')].map(encodePathPart).join('/');
}

function signRequest(method, key, payload, contentType) {
  const now = new Date();
  const amz = amzDate(now);
  const datestamp = dateStamp(now);
  const payloadHash = sha256(payload || Buffer.alloc(0));
  const uri = canonicalUri(cfg.bucket, key);
  const headers = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amz
  };
  if (contentType) headers['content-type'] = contentType;

  const sortedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedHeaderNames.map(name => `${name}:${headers[name]}\n`).join('');
  const signedHeaders = sortedHeaderNames.join(';');
  const canonicalRequest = [method, uri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const credentialScope = `${datestamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amz, credentialScope, sha256(canonicalRequest)].join('\n');

  const kDate = hmac('AWS4' + cfg.secretAccessKey, datestamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = hmac(kSigning, stringToSign, 'hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { uri, headers };
}

function s3Put(key, payload, contentType) {
  return new Promise((resolve, reject) => {
    const signed = signRequest('PUT', key, payload, contentType);
    const req = https.request({
      method: 'PUT',
      hostname: host,
      path: signed.uri,
      headers: {
        ...signed.headers,
        'content-length': payload.length
      }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function publicRequest(method, publicUrl) {
  return new Promise((resolve, reject) => {
    const req = https.request(publicUrl, { method }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        length: Number(res.headers['content-length'] || 0),
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

function publicUrlFor(key) {
  return `${cfg.publicBaseUrl.replace(/\/$/, '')}/${key}`;
}

(async () => {
  const results = [];

  for (const asset of assets) {
    const payload = asset.body || fs.readFileSync(asset.source);
    const put = await s3Put(asset.key, payload, asset.contentType);
    if (put.statusCode < 200 || put.statusCode >= 300) {
      throw new Error(`PUT failed for ${asset.key}: HTTP ${put.statusCode} ${put.body.slice(0, 300)}`);
    }

    const publicUrl = publicUrlFor(asset.key);
    const check = asset.key.endsWith('.exe') || asset.key.endsWith('.blockmap')
      ? await publicRequest('HEAD', publicUrl)
      : await publicRequest('GET', publicUrl);
    if (check.statusCode !== 200) {
      throw new Error(`Public verification failed for ${asset.key}: HTTP ${check.statusCode}`);
    }

    results.push({
      key: asset.key,
      bytes: payload.length,
      publicUrl
    });
  }

  console.log(JSON.stringify({ version, latestPrefix, results }, null, 2));
})().catch(err => {
  console.error(err.message);
  process.exit(1);
});
'@

$tempScript = Join-Path $env:TEMP "cotaska-upload-r2.js"
Set-Content -LiteralPath $tempScript -Value $nodeScript -Encoding UTF8

try {
    Write-Host "Uploading Cotaska release assets to R2 latest/ ..." -ForegroundColor Cyan
    & $nodeExe $tempScript $scriptDir $resolvedConfigPath $releaseArtifacts.Version $gitCommit
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[FAILED] R2 upload failed" -ForegroundColor Red
        exit 1
    }
    Write-Host "R2 upload complete." -ForegroundColor Green
}
finally {
    Remove-Item -LiteralPath $tempScript -Force -ErrorAction SilentlyContinue
}
