import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

export interface S3Config {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
}

export class ImageStore {
  private client: S3Client;
  private bucket: string;
  private endpointStr?: string;

  constructor(config: S3Config) {
    this.bucket = config.bucket;
    this.endpointStr = config.endpoint;
    this.client = new S3Client({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      ...(config.endpoint
        ? { endpoint: config.endpoint, forcePathStyle: true }
        : {}),
    });
  }

  /**
   * Upload a PNG buffer to S3 and return the public URL.
   * Key format: tenants/{tenantId}/images/{timestamp}-{hash}.png
   */
  async upload(
    tenantId: string,
    buffer: Buffer,
    hash: string,
  ): Promise<{ s3Key: string; s3Url: string }> {
    const timestamp = Date.now();
    const s3Key = `tenants/${tenantId}/images/${timestamp}-${hash}.png`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: s3Key,
        Body: buffer,
        ContentType: "image/png",
        ACL: "public-read",
      }),
    );

    // Build public URL
    let s3Url: string;
    if (this.endpointStr) {
      // S3-compatible (Vultr, MinIO): endpoint/bucket/key
      const base = this.endpointStr.replace(/\/$/, "");
      s3Url = `${base}/${this.bucket}/${s3Key}`;
    } else {
      // Standard AWS S3
      s3Url = `https://${this.bucket}.s3.amazonaws.com/${s3Key}`;
    }

    return { s3Key, s3Url };
  }
}
