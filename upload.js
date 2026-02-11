const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');

// Configure AWS SDK from environment
AWS.config.update({ region: process.env.AWS_REGION || 'us-east-1' });

const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  signatureVersion: 'v4'
});

async function getSignedUploadUrl(req, res) {
  try {
    const { userId, fileName, contentType } = req.body;
    if (!fileName || !contentType) return res.status(400).json({ success: false, error: 'fileName and contentType required' });

    // additional server-side validation (defense-in-depth)
    const filenameSafe = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
    const key = `documents/${userId || 'anon'}/${Date.now()}_${uuidv4()}_${filenameSafe}`;
    const params = {
      Bucket: process.env.S3_BUCKET,
      Key: key,
      Expires: 60 * 5, // 5 minutes
      ContentType: contentType,
      ACL: 'private'
    };

    const url = await s3.getSignedUrlPromise('putObject', params);
    // Public URL depends on bucket policy; provide best-effort public URL template
    const publicUrl = `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${encodeURIComponent(key)}`;

    res.json({ success: true, data: { url, publicUrl, key } });
  } catch (err) {
    console.error('Signed url error', err);
    res.status(500).json({ success: false, error: String(err) });
  }
}

module.exports = { getSignedUploadUrl };
