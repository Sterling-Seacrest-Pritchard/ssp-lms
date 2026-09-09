import { Storage } from "@google-cloud/storage";

// Matches the subset of the Supabase Storage client interface this codebase
// used (`.from(bucket).upload/list/remove/download`), so call sites written
// against Supabase needed no changes beyond the import path. `list()` mirrors
// Supabase's non-recursive-with-synthetic-folder-rows behavior: GCS has no
// real directories, so a `delimiter: "/"` listing's `prefixes` become
// folder-shaped rows (`id: null`) and its `files` become real-object rows.
interface StorageError {
  message: string;
}

interface StorageListEntry {
  name: string;
  id: string | null;
  metadata?: { mimetype?: string };
}

interface StorageDownloadResult {
  data: { arrayBuffer(): Promise<ArrayBuffer> } | null;
  error: StorageError | null;
}

interface StorageListResult {
  data: StorageListEntry[] | null;
  error: StorageError | null;
}

interface StorageMutationResult {
  error: StorageError | null;
}

// On Cloud Run, Application Default Credentials come from the service's own
// identity automatically. Platforms without that (e.g. Vercel) need explicit
// credentials, passed as the full key JSON via GOOGLE_APPLICATION_CREDENTIALS_JSON
// rather than a file path, since there's no persistent filesystem to point at.
const storage = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON
  ? new Storage({ credentials: JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) })
  : new Storage();

function bucketApi(bucketName: string) {
  const bucket = storage.bucket(bucketName);

  return {
    async upload(
      path: string,
      body: Buffer,
      options: { upsert?: boolean; contentType?: string }
    ): Promise<StorageMutationResult> {
      try {
        await bucket.file(path).save(body, {
          contentType: options.contentType,
          resumable: false,
        });
        return { error: null };
      } catch (err) {
        return { error: { message: err instanceof Error ? err.message : String(err) } };
      }
    },

    async list(prefix: string): Promise<StorageListResult> {
      try {
        const normalizedPrefix = prefix ? `${prefix}/` : "";
        const [files, , apiResponse] = await bucket.getFiles({
          prefix: normalizedPrefix,
          delimiter: "/",
          autoPaginate: false,
        });
        const prefixes = (apiResponse as { prefixes?: string[] } | undefined)?.prefixes ?? [];

        const entries: StorageListEntry[] = [];
        for (const prefixPath of prefixes) {
          const name = prefixPath.slice(normalizedPrefix.length).replace(/\/$/, "");
          entries.push({ name, id: null });
        }
        for (const file of files) {
          const name = file.name.slice(normalizedPrefix.length);
          if (name) {
            entries.push({
              name,
              id: file.metadata.generation != null ? String(file.metadata.generation) : file.name,
              metadata: { mimetype: file.metadata.contentType },
            });
          }
        }
        return { data: entries, error: null };
      } catch (err) {
        return { data: null, error: { message: err instanceof Error ? err.message : String(err) } };
      }
    },

    async remove(paths: string[]): Promise<StorageMutationResult> {
      try {
        await Promise.all(paths.map((path) => bucket.file(path).delete()));
        return { error: null };
      } catch (err) {
        return { error: { message: err instanceof Error ? err.message : String(err) } };
      }
    },

    async download(path: string): Promise<StorageDownloadResult> {
      try {
        const [buf] = await bucket.file(path).download();
        return {
          data: {
            arrayBuffer: async () =>
              buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
          },
          error: null,
        };
      } catch (err) {
        return { data: null, error: { message: err instanceof Error ? err.message : String(err) } };
      }
    },
  };
}

export const gcsStorage = {
  from: (bucketName: string) => bucketApi(bucketName),
};
