const GITHUB_API_BASE = "https://api.github.com";

function requiredGitHubConfig() {
  const token =
    process.env.GITHUB_CERTIFICATES_TOKEN?.trim();

  const owner =
    process.env.GITHUB_CERTIFICATES_OWNER?.trim();

  const repo =
    process.env.GITHUB_CERTIFICATES_REPO?.trim();

  const folder =
    process.env.GITHUB_CERTIFICATES_FOLDER?.trim() ||
    "certificates";

  if (!token || !owner || !repo) {
    const error = new Error(
      "GitHub certificate storage is not fully configured."
    );

    error.status = 503;
    throw error;
  }

  return {
    token,
    owner,
    repo,
    folder: folder.replace(/^\/+|\/+$/g, "")
  };
}

async function githubRequest(
  path,
  {
    method = "GET",
    body
  } = {}
) {
  const {
    token
  } = requiredGitHubConfig();

  const response = await fetch(
    `${GITHUB_API_BASE}${path}`,
    {
      method,

      headers: {
        Accept:
          "application/vnd.github+json",

        Authorization:
          `Bearer ${token}`,

        "X-GitHub-Api-Version":
          "2022-11-28",

        "User-Agent":
          "Wolf-Warehouse-Dashboard"
      },

      body:
        body === undefined
          ? undefined
          : JSON.stringify(body)
    }
  );

  const text =
    await response.text();

  let payload;

  try {
    payload = text
      ? JSON.parse(text)
      : {};
  } catch {
    payload = {
      raw: text
    };
  }

  if (!response.ok) {
    console.error(
      "[GitHub API error]",
      response.status,
      payload
    );

    const error = new Error(
      payload?.message ||
      `GitHub returned HTTP ${response.status}.`
    );

    error.status =
      response.status;

    error.payload =
      payload;

    throw error;
  }

  return payload;
}

function normaliseAssetNumber(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "");
}

function normaliseDescription(value) {
  return String(value ?? "")
    .trim()
    .replace(/\.pdf$/i, "")
    .replace(/[\/\\:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

function encodeRepositoryPath(path) {
  return path
    .split("/")
    .map(encodeURIComponent)
    .join("/");
}

export async function listGitHubCertificates() {
  const {
    owner,
    repo,
    folder
  } = requiredGitHubConfig();

  const encodedFolder =
    encodeRepositoryPath(folder);

  const payload =
    await githubRequest(
      `/repos/${encodeURIComponent(owner)}` +
      `/${encodeURIComponent(repo)}` +
      `/contents/${encodedFolder}`
    );

  return (
    Array.isArray(payload)
      ? payload
      : []
  ).filter(
    (entry) =>
      entry?.type === "file" &&
      String(entry.name || "")
        .toLowerCase()
        .endsWith(".pdf")
  );
}

export async function findGitHubCertificates(
  rawAssetNumbers
) {
  const assetNumbers = [
    ...new Set(
      (Array.isArray(rawAssetNumbers)
        ? rawAssetNumbers
        : [])
        .map(normaliseAssetNumber)
        .filter(Boolean)
    )
  ];

  const files =
    await listGitHubCertificates();

  const found = [];
  const missing = [];

  for (const assetNumber of assetNumbers) {
    const prefix =
      `${assetNumber.toLowerCase()} `;

    const matches =
      files.filter(
        (file) =>
          String(file.name || "")
            .toLowerCase()
            .startsWith(prefix)
      );

    if (!matches.length) {
      missing.push(assetNumber);
      continue;
    }

    for (const file of matches) {
      found.push({
        assetNumber,
        filename:
          file.name,
        path:
          file.path,
        sha:
          file.sha,
        sizeBytes:
          Number(file.size || 0),
        downloadUrl:
          file.download_url || null
      });
    }
  }

  return {
    found,
    missing,
    totalCertificates:
      files.length
  };
}

export async function uploadGitHubCertificate({
  assetNumber,
  description,
  pdfBuffer
}) {
  const {
    owner,
    repo,
    folder
  } = requiredGitHubConfig();

  const cleanedAsset =
    normaliseAssetNumber(assetNumber);

  const cleanedDescription =
    normaliseDescription(description) ||
    "motor certificate";

  if (!/^[A-Za-z0-9_-]{3,40}$/.test(cleanedAsset)) {
    const error = new Error(
      "Enter a valid asset number."
    );

    error.status = 400;
    throw error;
  }

  if (!Buffer.isBuffer(pdfBuffer)) {
    const error = new Error(
      "A PDF file is required."
    );

    error.status = 400;
    throw error;
  }

  const filename =
    `${cleanedAsset} ${cleanedDescription}.pdf`;

  const repositoryPath =
    `${folder}/${filename}`;

  const encodedPath =
    encodeRepositoryPath(repositoryPath);

  let existingFile = null;

  try {
    existingFile =
      await githubRequest(
        `/repos/${encodeURIComponent(owner)}` +
        `/${encodeURIComponent(repo)}` +
        `/contents/${encodedPath}`
      );
  } catch (error) {
    if (error.status !== 404) {
      throw error;
    }
  }

  const body = {
    message:
      existingFile
        ? `Replace certificate ${cleanedAsset}`
        : `Add certificate ${cleanedAsset}`,

    content:
      pdfBuffer.toString("base64")
  };

  if (existingFile?.sha) {
    body.sha =
      existingFile.sha;
  }

  const result =
    await githubRequest(
      `/repos/${encodeURIComponent(owner)}` +
      `/${encodeURIComponent(repo)}` +
      `/contents/${encodedPath}`,
      {
        method: "PUT",
        body
      }
    );

  return {
    assetNumber:
      cleanedAsset,

    filename,

    path:
      result?.content?.path ||
      repositoryPath,

    sha:
      result?.content?.sha ||
      null
  };
}

export async function getCertificateBuffers(
  assetNumbers
) {
  const results =
    await findGitHubCertificates(
      assetNumbers
    );

  const attachments =
    await Promise.all(
      results.found.map(
        async (certificate) => {
          const response =
            await fetch(
              certificate.downloadUrl
            );

          const arrayBuffer =
            await response.arrayBuffer();

          return {
            filename:
              certificate.filename,

            content:
              Buffer.from(
                arrayBuffer
              )
          };
        }
      )
    );

  return {
    attachments,
    found:
      results.found,
    missing:
      results.missing
  };
}