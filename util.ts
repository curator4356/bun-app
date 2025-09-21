import type { ServerWebSocket } from "bun";
import type { WebSocketData } from "./types";
import { join } from "path";

function parseContentDisposition(header: string): string | null {
  if (!header) return null;

  const filenameStarMatch = header.match(/filename\*=([^;]+)/i);
  if (filenameStarMatch) {
    try {
      // Handle UTF-8''filename format
      const value = filenameStarMatch[1];
      if (value) {
        return value.startsWith("UTF-8''")
          ? decodeURIComponent(value.substring(7))
          : decodeURIComponent(value);
      }
    } catch (error) {
      console.error("Error in parseContentDisposition", error);
      return null;
    }
  }

  const filenameMatch = header.match(/filename=["']?([^"';]+)["']?/i);
  if (filenameMatch) {
    return filenameMatch[1] ? filenameMatch[1].trim() : null;
  }

  return null;
}

function sanitizeFilename(filename: string): string {
  if (!filename) return `download_${Date.now()}`;

  // Remove dangerous characters and paths
  return (
    filename
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") // Replace invalid chars
      .replace(/^\.+/, "") // Remove leading dots
      .replace(/\.+$/, "") // Remove trailing dots
      .replace(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i, "_$1") // Handle Windows reserved names
      .trim()
      .substring(0, 255) || `download_${Date.now()}`
  );
}

export function extractFilename(
  url: string,
  contentDisposition?: string
): string {
  if (contentDisposition) {
    const cdFilename = parseContentDisposition(contentDisposition);
    if (cdFilename) {
      return sanitizeFilename(cdFilename);
    }
  }

  try {
    const urlObj = new URL(url);
    let pathname = urlObj.pathname;

    const filename = pathname.split("/").pop() || `download_${Date.now()}`;

    // Remove query parameters from filename
    const cleanFilename = filename.split("?")[0] || `download_${Date.now()}`;

    return (
      sanitizeFilename(decodeURIComponent(cleanFilename)) ||
      `download_${Date.now()}`
    );
  } catch {
    return `download_${Date.now()}`;
  }
}

async function getUniqueFilename(originalPath: string): Promise<string> {
  // If file doesn't exist, return original path
  if (!(await Bun.file(originalPath).exists())) {
    return originalPath;
  }

  // Extract filename and extension
  const lastSlash = originalPath.lastIndexOf("/");
  const dir = originalPath.substring(0, lastSlash);
  const filename = originalPath.substring(lastSlash + 1);

  const lastDot = filename.lastIndexOf(".");
  const nameWithoutExt =
    lastDot === -1 ? filename : filename.substring(0, lastDot);
  const ext = lastDot === -1 ? "" : filename.substring(lastDot);

  // Find available filename with counter
  let counter = 1;
  let newPath: string;

  do {
    const newFilename = `${nameWithoutExt}(${counter})${ext}`;
    newPath = `${dir}/${newFilename}`;
    counter++;
  } while (await Bun.file(newPath).exists()); // Fixed: check newPath, not originalPath

  return newPath;
}

export function isValidUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return urlObj.protocol === "http:" || urlObj.protocol === "https:";
  } catch {
    return false;
  }
}

export async function downloadFile(
  ws: ServerWebSocket<WebSocketData>,
  url: string
) {
  const controller = new AbortController();
  ws.data.downloadController = controller;
  try {
    const response = await fetch(url, { signal: controller.signal });

    if (!response.ok) {
      ws.send(
        JSON.stringify({
          type: "download_error",
          message: `Server error: ${response.status} ${response.statusText}`,
        })
      );
      return;
    }

    const contentDisposition = response.headers.get("content-disposition");
    const filename = extractFilename(url, contentDisposition || undefined);
    const originalPath = join("./downloads", filename);
    const filePath = await getUniqueFilename(originalPath);

    // Get final filename for display
    const finalFilename = filePath.split("/").pop() || filename;

    const reader = response.body?.getReader();

    if (!reader) {
      ws.send(
        JSON.stringify({
          type: "download_error",
          message: "No response body available",
        })
      );
      return;
    }

    const contentLength = response.headers.get("content-length");
    const totalSize = contentLength ? parseInt(contentLength) : 0;
    let downloadedSize = 0;
    const chunks: Uint8Array[] = [];
    const startTime = Date.now();

    ws.send(
      JSON.stringify({
        type: "download_info",
        filename: finalFilename,
      })
    );

    while (true) {
      if (controller.signal.aborted) {
        reader.cancel();
        return;
      }

      const { done, value } = await reader.read();

      if (done) break;

      chunks.push(value);
      downloadedSize += value.length;

      if (totalSize > 0) {
        const progress = Math.floor((downloadedSize / totalSize) * 100);
        ws.send(
          JSON.stringify({
            type: "download_progress",
            progress,
            downloadedBytes: downloadedSize,
            totalBytes: totalSize,
          })
        );
      }
    }

    // Combine all chunks and save file
    const fileData = new Uint8Array(downloadedSize);
    let offset = 0;
    for (const chunk of chunks) {
      fileData.set(chunk, offset);
      offset += chunk.length;
    }

    await Bun.write(filePath, fileData);

    ws.send(JSON.stringify({ type: "download_complete", progress: 100 }));
  } catch (error: any) {
    if (error.name === "AbortError") {
      // Download was cancelled, don't send error
      return;
    }

    console.error("Download error:", error);
    let errorMessage = "Download failed";

    if (error.code === "ENOTFOUND") {
      errorMessage = "Domain not found";
    } else if (error.code === "ECONNRESET") {
      errorMessage = "Connection lost";
    } else if (error.code === "ETIMEDOUT") {
      errorMessage = "Connection timeout";
    } else if (error.name === "TypeError") {
      errorMessage = "Network error";
    }

    ws.send(JSON.stringify({ type: "download_error", message: errorMessage }));
  } finally {
    // Clean up controller reference
    if (ws.data.downloadController === controller) {
      ws.data.downloadController = undefined;
    }
  }
}
