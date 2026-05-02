import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

const PUT_TTL_SECONDS = 5 * 60;
const GET_TTL_SECONDS = 60;

function client(cfg: R2Config): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
    // R2 does not require the SDK's default CRC32 checksum, and including
    // x-amz-checksum-crc32 / x-amz-sdk-checksum-algorithm in the signed URL
    // makes browser PUTs without a matching header fail.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

export async function presignPut(
  cfg: R2Config,
  key: string,
  contentType: string
): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(client(cfg), cmd, { expiresIn: PUT_TTL_SECONDS });
}

export async function presignGet(
  cfg: R2Config,
  key: string,
  fileName: string,
  mimeType: string
): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: cfg.bucket,
    Key: key,
    ResponseContentDisposition: `attachment; filename="${encodeRfc5987(fileName)}"`,
    ResponseContentType: mimeType,
  });
  return getSignedUrl(client(cfg), cmd, { expiresIn: GET_TTL_SECONDS });
}

// RFC 5987 ext-value for filename* with non-ASCII safety.
function encodeRfc5987(name: string): string {
  return name.replace(/["\\\r\n]/g, '_');
}
