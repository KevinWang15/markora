export type MarkdownEditorResourceKind = "image" | "link";
export type MarkdownEditorResourcePurpose = "load" | "open";

export type MarkdownEditorUrlPolicy = {
  allowCredentials?: boolean;
  allowedDataMimeTypes?: readonly string[];
  allowedProtocols?: readonly string[];
  allowRelative?: boolean;
  maxDataUrlBytes?: number;
  maxDataUrlCharacters?: number;
};

export type MarkdownEditorImagePolicy = MarkdownEditorUrlPolicy & {
  crossOrigin?: "anonymous" | "use-credentials" | null;
  referrerPolicy?: ReferrerPolicy;
};

export type MarkdownEditorResolveUrlRequest = Readonly<{
  kind: MarkdownEditorResourceKind;
  purpose: MarkdownEditorResourcePurpose;
  url: string;
}>;

export type MarkdownEditorOpenUrlRequest = Readonly<{
  event: MouseEvent;
  kind: MarkdownEditorResourceKind;
  storedUrl: string;
  url: string;
}>;

export type MarkdownEditorImageLoadRequest = Readonly<{
  signal: AbortSignal;
  storedUrl: string;
  url: string;
}>;

export type MarkdownEditorImageLoadResult = Readonly<{
  cleanup?: () => void;
  crossOrigin?: "anonymous" | "use-credentials" | null;
  referrerPolicy?: ReferrerPolicy;
  src: Blob | string;
}>;

export type MarkdownEditorAssetTransferKind = "drop" | "paste";
export type MarkdownEditorAssetInsertionKind = "image" | "link";

export type MarkdownEditorAssetUploadResult =
  | Readonly<{
      alt?: string | null;
      kind: "image";
      title?: string | null;
      url: string;
    }>
  | Readonly<{
      kind: "link";
      label?: string | null;
      title?: string | null;
      url: string;
    }>;

export type MarkdownEditorAssetUploadRequest = Readonly<{
  file: File;
  id: string;
  reportProgress: (progress: number) => void;
  signal: AbortSignal;
  source: MarkdownEditorAssetTransferKind;
}>;

export type MarkdownEditorAssetUploadOptions = {
  allowedMimeTypes?: readonly string[];
  maxFileBytes?: number;
  maxFiles?: number;
  upload: (
    request: MarkdownEditorAssetUploadRequest,
  ) => MarkdownEditorAssetUploadResult | PromiseLike<MarkdownEditorAssetUploadResult>;
};

export type MarkdownEditorResourceOptions = {
  assets?: MarkdownEditorAssetUploadOptions;
  images?: MarkdownEditorImagePolicy;
  links?: MarkdownEditorUrlPolicy;
  loadImage?: (
    request: MarkdownEditorImageLoadRequest,
  ) => MarkdownEditorImageLoadResult | null | PromiseLike<MarkdownEditorImageLoadResult | null>;
  openUrl?: (request: MarkdownEditorOpenUrlRequest) => void;
  resolveUrl?: (request: MarkdownEditorResolveUrlRequest) => string | null;
};

export type MarkdownEditorAssetUploadErrorCode =
  | "file-too-large"
  | "insertion-blocked"
  | "invalid-result"
  | "too-many-files"
  | "unsupported-file-type"
  | "upload-failed";

export type MarkdownEditorAssetUploadError = Readonly<{
  cause?: unknown;
  code: MarkdownEditorAssetUploadErrorCode;
  message: string;
}>;

export type MarkdownEditorAssetFileSnapshot = Readonly<{
  lastModified: number;
  name: string;
  size: number;
  type: string;
}>;

export type MarkdownEditorAssetUploadStatus =
  | "cancelled"
  | "completed"
  | "failed"
  | "rejected"
  | "uploading";

export type MarkdownEditorAssetUploadSnapshot = Readonly<{
  error?: MarkdownEditorAssetUploadError;
  file: MarkdownEditorAssetFileSnapshot;
  id: string;
  progress: number | null;
  source: MarkdownEditorAssetTransferKind;
  status: MarkdownEditorAssetUploadStatus;
}>;

export type MarkdownEditorAssetEventReason =
  | "cancelled"
  | "completed"
  | "failed"
  | "progress"
  | "rejected"
  | "retried"
  | "started";

export type MarkdownEditorAssets = {
  cancel: (id: string) => boolean;
  getUploads: () => readonly MarkdownEditorAssetUploadSnapshot[];
  retry: (id: string) => boolean;
};

export type MarkdownEditorResourceErrorPhase = "cleanup" | "load" | "open" | "resolve";
