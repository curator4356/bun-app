import { serve, randomUUIDv7, type ServerWebSocket, file } from "bun";
import index from "./view/index.html";
import { mkdir, readdir, exists, stat } from "fs/promises";
import { join } from "path";
import type { ListFiles, RequstDownload, WebSocketData } from "./types";
import { downloadFile, extractFilename, isValidUrl } from "./util";

const activeConnections = new Set<ServerWebSocket<WebSocketData>>();

function generateUserId(): string {
  return randomUUIDv7();
}

async function getFilesInfo(): Promise<ListFiles[]> {
  try {
    const downloadPath = "./downloads";
    if (!(await exists(downloadPath))) {
      await mkdir(downloadPath, { recursive: true });
      return [];
    }
    const files = await readdir(downloadPath);
    const fileInfo = await Promise.all(
      files.map(async (filename) => {
        const filePath = join(downloadPath, filename);
        const stats = await stat(filePath);
        return {
          name: filename,
          size: stats.size,
          modified: stats.mtime,
        };
      })
    );
    return fileInfo;
  } catch (error) {
    console.error("Error in getFilesInfo:", error);
    return [];
  }
}

const server = serve({
  routes: {
    "/": index,
    "/ws": {
      async GET(req, server) {
        const id = generateUserId();
        const ok = server.upgrade(req, { data: { id } });
        return ok
          ? new Response()
          : new Response("Upgrade failed", { status: 400 });
      },
    },
    "/download": {
      async POST(req) {
        try {
          const body = (await req.json()) as RequstDownload;
          const { url } = body;

          if (!url || !isValidUrl(url)) {
            return Response.json({ error: "Invalid URL" }, { status: 400 });
          }

          console.log("📥 Download request for:", url);

          try {
            const headResponse = await fetch(url, { method: "HEAD" });

            if (!headResponse.ok) {
              return Response.json(
                {
                  error: `File not accessible returned status code ${headResponse.status}`,
                },
                { status: 400 }
              );
            }

            const contentLength = headResponse.headers.get("content-length");
            const contentDisposition = headResponse.headers.get(
              "content-disposition"
            );
            const size = contentLength ? parseInt(contentLength) : 0;
            const filename = extractFilename(
              url,
              contentDisposition || undefined
            );

            return Response.json({
              message: "download started",
              filename,
              size,
            });
          } catch (fetchError: any) {
            if (fetchError.name === "TimeoutError") {
              return Response.json(
                { error: "Connection timeout - server too slow to respond" },
                { status: 408 }
              );
            }
            return Response.json(
              { error: "Unable to connect to server" },
              { status: 400 }
            );
          }
        } catch (error) {
          console.error("Download error:", error);
          return Response.json({ error: "Download failed" }, { status: 500 });
        }
      },
    },
    "/getfiles": {
      async GET() {
        const files = await getFilesInfo();
        return Response.json({ files, count: files.length });
      },
    },
    "/file/:filename": {
      async GET(req) {
        try {
          const url = new URL(req.url);
          const filename = url.pathname.split("/").pop();
          if (!filename) return new Response("File not found", { status: 404 });
          const filePath = join("./downloads", decodeURIComponent(filename));
          try {
            const file = Bun.file(filePath);
            return new Response(file);
          } catch {
            return new Response("File not found", { status: 404 });
          }
        } catch (error) {
          console.error("Error serving file:", error);
          return new Response("Internal server error", { status: 500 });
        }
      },

      async DELETE(req) {
        const url = new URL(req.url);
        const filename = url.pathname.split("/").pop();
        if (!filename) return new Response("File not found", { status: 404 });
        const filePath = join("./downloads", decodeURIComponent(filename));

        try {
          await Bun.file(filePath).delete();
          return new Response(null, { status: 204 });
        } catch (error: any) {
          console.error(`Error deleting file ${filename}:`, error);
          if (
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          ) {
            return new Response("File not found", { status: 404 });
          }
          return new Response("Failed to delete file", { status: 500 });
        }
      },
    },
  },
  websocket: {
    message(ws: ServerWebSocket<WebSocketData>, message) {
      const id = ws.data.id;
      console.log("📩 got message from ", id, " ---> ", message);

      try {
        const data = JSON.parse(message as string);

        if (data.type === "start_download" && data.url) {
          downloadFile(ws, data.url);
        } else if (data.type === "cancel_download") {
          if (ws.data.downloadController) {
            ws.data.downloadController.abort();
            ws.send(JSON.stringify({ type: "download_cancelled" }));
          }
        } else if (data.type === "message") {
          ws.send(
            JSON.stringify({
              type: "message",
              message: `🔉 Echo: ${data.message}`,
            })
          );
        }
      } catch (error: any) {
        ws.send(
          JSON.stringify({
            type: "download_error",
            message: error.message,
          })
        );
      }
    },
    open(ws: ServerWebSocket<WebSocketData>) {
      const id = ws.data.id;
      console.log("🔗 Client connected", id);
      activeConnections.add(ws);
      ws.send(JSON.stringify({ event: "Hello from Bun server 👋", id }));
    },
    close(ws: ServerWebSocket<WebSocketData>) {
      const id = ws.data.id;
      activeConnections.delete(ws);
      console.log("❌ Client disconnected", id);
    },
  },

  development: false,
  port: 3000,
});

function gracefulShutdown() {
  console.log("\n🛑 Shutting down server...");

  // Close all active WebSocket connections
  for (const ws of activeConnections) {
    try {
      ws.close();
    } catch (error) {
      // Connection might already be closed
    }
  }

  // Stop the server
  server.stop();
  process.exit(0);
}

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);

console.log("🚀 Bun server listening on http://localhost:3000");
