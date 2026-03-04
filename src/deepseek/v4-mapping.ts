export const V4_ENDPOINTS = {
  visionUpload: "/files",
  imageGeneration: "/images/generations",
  videoUpload: "/files",
  videoGeneration: "/videos/generations",
  taskStatusTemplate: "/tasks/{task_id}",
} as const;

export const V4_ENDPOINT_CANDIDATES = {
  visionUpload: ["/files", "/images/uploads", "/vision/uploads"],
  videoUpload: ["/files", "/videos/uploads", "/video/uploads"],
  imageGeneration: ["/images/generations", "/images"],
  videoGeneration: ["/videos/generations", "/video/generations"],
  taskStatusTemplate: ["/tasks/{task_id}", "/jobs/{task_id}"],
} as const;

export interface V4VisionUploadInput {
  file_url?: string;
  file_base64?: string;
  mime_type?: string;
  filename?: string;
  purpose?: string;
  model?: string;
  extra_body?: Record<string, unknown>;
}

export interface V4VideoUploadInput {
  file_url?: string;
  file_base64?: string;
  mime_type?: string;
  filename?: string;
  purpose?: string;
  model?: string;
  extra_body?: Record<string, unknown>;
}

export interface V4ImageGenerationInput {
  prompt: string;
  model?: string;
  size?: string;
  n?: number;
  response_format?: "url" | "b64_json";
  quality?: string;
  style?: string;
  seed?: number;
  extra_body?: Record<string, unknown>;
}

export interface V4VideoGenerationInput {
  prompt: string;
  model?: string;
  duration_seconds?: number;
  resolution?: string;
  fps?: number;
  seed?: number;
  image_url?: string;
  n?: number;
  extra_body?: Record<string, unknown>;
}

export interface V4NormalizedUploadResponse {
  id: string | null;
  status: string | null;
  asset_url: string | null;
  bytes: number | null;
}

export interface V4NormalizedImageGenerationResponse {
  id: string | null;
  status: string | null;
  created: number | null;
  image_urls: string[];
  b64_images: string[];
}

export interface V4NormalizedVideoGenerationResponse {
  id: string | null;
  task_id: string | null;
  status: string | null;
  video_url: string | null;
}

export interface V4NormalizedTaskStatusResponse {
  task_id: string | null;
  status: string | null;
  video_url: string | null;
}

export function buildVisionUploadRequest(input: V4VisionUploadInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    purpose: input.purpose ?? "vision",
    media_type: "image",
  };

  if (input.file_url) {
    body.input_url = input.file_url;
  }

  if (input.file_base64) {
    body.input_base64 = input.file_base64;
  }

  if (input.mime_type) {
    body.mime_type = input.mime_type;
  }

  if (input.filename) {
    body.filename = input.filename;
  }

  if (input.model) {
    body.model = input.model;
  }

  if (input.extra_body) {
    Object.assign(body, input.extra_body);
  }

  return body;
}

export function buildVideoUploadRequest(input: V4VideoUploadInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    purpose: input.purpose ?? "video",
    media_type: "video",
  };

  if (input.file_url) {
    body.input_url = input.file_url;
  }

  if (input.file_base64) {
    body.input_base64 = input.file_base64;
  }

  if (input.mime_type) {
    body.mime_type = input.mime_type;
  }

  if (input.filename) {
    body.filename = input.filename;
  }

  if (input.model) {
    body.model = input.model;
  }

  if (input.extra_body) {
    Object.assign(body, input.extra_body);
  }

  return body;
}

export function buildImageGenerationRequest(input: V4ImageGenerationInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    prompt: input.prompt,
  };

  if (input.model) {
    body.model = input.model;
  }

  if (input.size) {
    body.size = input.size;
  }

  if (input.n !== undefined) {
    body.n = input.n;
  }

  if (input.response_format) {
    body.response_format = input.response_format;
  }

  if (input.quality) {
    body.quality = input.quality;
  }

  if (input.style) {
    body.style = input.style;
  }

  if (input.seed !== undefined) {
    body.seed = input.seed;
  }

  if (input.extra_body) {
    Object.assign(body, input.extra_body);
  }

  return body;
}

export function buildVideoGenerationRequest(input: V4VideoGenerationInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    prompt: input.prompt,
  };

  if (input.model) {
    body.model = input.model;
  }

  if (input.duration_seconds !== undefined) {
    body.duration_seconds = input.duration_seconds;
  }

  if (input.resolution) {
    body.resolution = input.resolution;
  }

  if (input.fps !== undefined) {
    body.fps = input.fps;
  }

  if (input.seed !== undefined) {
    body.seed = input.seed;
  }

  if (input.image_url) {
    body.image_url = input.image_url;
  }

  if (input.n !== undefined) {
    body.n = input.n;
  }

  if (input.extra_body) {
    Object.assign(body, input.extra_body);
  }

  return body;
}

export function normalizeUploadResponse(payload: unknown): V4NormalizedUploadResponse {
  return {
    id: pickString(payload, ["id", "file_id", "data.id", "result.id"]),
    status: pickString(payload, ["status", "state", "data.status", "result.status"]),
    asset_url: pickString(payload, ["url", "file_url", "data.url", "result.url"]),
    bytes: pickNumber(payload, ["bytes", "size", "data.bytes", "result.bytes"]),
  };
}

export function normalizeImageGenerationResponse(payload: unknown): V4NormalizedImageGenerationResponse {
  const dataArray = pickArray(payload, ["data", "images", "result.images"]);
  const imageUrls: string[] = [];
  const b64Images: string[] = [];

  for (const item of dataArray) {
    if (!isObject(item)) {
      continue;
    }

    if (typeof item.url === "string") {
      imageUrls.push(item.url);
    }

    if (typeof item.b64_json === "string") {
      b64Images.push(item.b64_json);
    }
  }

  const directUrl = pickString(payload, ["url", "image_url", "result.url"]);
  if (directUrl) {
    imageUrls.push(directUrl);
  }

  return {
    id: pickString(payload, ["id", "task_id", "job_id", "data.id", "result.id"]),
    status: pickString(payload, ["status", "state", "data.status", "result.status"]),
    created: pickNumber(payload, ["created", "created_at", "data.created", "result.created"]),
    image_urls: dedupe(imageUrls),
    b64_images: dedupe(b64Images),
  };
}

export function normalizeVideoGenerationResponse(payload: unknown): V4NormalizedVideoGenerationResponse {
  return {
    id: pickString(payload, ["id", "video_id", "data.id", "result.id"]),
    task_id: pickString(payload, ["task_id", "job_id", "id", "data.task_id", "result.task_id"]),
    status: pickString(payload, ["status", "state", "data.status", "result.status"]),
    video_url: pickString(payload, ["video_url", "url", "data.video_url", "result.video_url"]),
  };
}

export function normalizeTaskStatusResponse(payload: unknown): V4NormalizedTaskStatusResponse {
  return {
    task_id: pickString(payload, ["task_id", "job_id", "id", "data.task_id", "result.task_id"]),
    status: pickString(payload, ["status", "state", "data.status", "result.status"]),
    video_url: pickString(payload, ["video_url", "url", "data.video_url", "result.video_url"]),
  };
}

export function buildTaskStatusPath(taskId: string): string {
  return V4_ENDPOINTS.taskStatusTemplate.replace("{task_id}", encodeURIComponent(taskId));
}

export function isTerminalTaskStatus(status: string | null): boolean {
  if (!status) {
    return false;
  }

  const normalized = status.toLowerCase();
  return ["completed", "succeeded", "success", "failed", "error", "cancelled", "canceled", "done"].includes(
    normalized,
  );
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function pickString(payload: unknown, paths: string[]): string | null {
  for (const path of paths) {
    const value = getPath(payload, path);
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return null;
}

function pickNumber(payload: unknown, paths: string[]): number | null {
  for (const path of paths) {
    const value = getPath(payload, path);
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function pickArray(payload: unknown, paths: string[]): unknown[] {
  for (const path of paths) {
    const value = getPath(payload, path);
    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

function getPath(payload: unknown, path: string): unknown {
  if (!isObject(payload)) {
    return undefined;
  }

  const segments = path.split(".");
  let current: unknown = payload;

  for (const segment of segments) {
    if (!isObject(current)) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
