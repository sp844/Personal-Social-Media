const { google } = require('googleapis');
const fs = require('fs').promises;
const path = require('path');

function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

function getDriveClient(tokens) {
  const auth = createOAuth2Client();
  auth.setCredentials(tokens);
  return google.drive({ version: 'v3', auth });
}

async function listFiles(drive, folderId = 'root') {
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType, size, thumbnailLink, videoMediaMetadata, imageMediaMetadata, modifiedTime)',
    orderBy: 'folder,name',
    pageSize: 100
  });
  return res.data.files || [];
}

async function downloadFile(drive, fileId, destPath) {
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' }
  );

  const destDir = path.dirname(destPath);
  await fs.mkdir(destDir, { recursive: true });

  return new Promise((resolve, reject) => {
    const dest = require('fs').createWriteStream(destPath);
    res.data
      .on('end', () => resolve(destPath))
      .on('error', reject)
      .pipe(dest);
  });
}

async function getFileThumbnail(drive, fileId) {
  try {
    const res = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' }
    );
    return res.data;
  } catch (err) {
    // Try thumbnail link as fallback
    const file = await drive.files.get({
      fileId,
      fields: 'thumbnailLink'
    });
    if (file.data.thumbnailLink) {
      const fetch = require('node-fetch');
      const resp = await fetch(file.data.thumbnailLink);
      return resp.body;
    }
    throw err;
  }
}

async function ensureOutputFolder(drive) {
  const folderName = 'Reel Director Output';

  // Check if folder exists
  const res = await drive.files.list({
    q: `name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)'
  });

  if (res.data.files && res.data.files.length > 0) {
    return res.data.files[0].id;
  }

  // Create folder
  const folder = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder'
    },
    fields: 'id'
  });

  return folder.data.id;
}

async function uploadToDrive(drive, localPath, fileName, folderId) {
  const fileContent = await fs.readFile(localPath);

  const res = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId]
    },
    media: {
      body: require('fs').createReadStream(localPath)
    },
    fields: 'id, webViewLink'
  });

  // Make file readable via link
  try {
    await drive.permissions.create({
      fileId: res.data.id,
      requestBody: {
        role: 'reader',
        type: 'anyone'
      }
    });
  } catch (e) {
    // Permission setting may fail, non-critical
  }

  return {
    fileId: res.data.id,
    webViewLink: res.data.webViewLink
  };
}

module.exports = {
  createOAuth2Client,
  getDriveClient,
  listFiles,
  downloadFile,
  getFileThumbnail,
  ensureOutputFolder,
  uploadToDrive
};
