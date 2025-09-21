
let ws = null;
let clientId = null;

// DOM elements
const statusEl = document.getElementById("status");
const connectBtn = document.getElementById("connect-btn");
const disconnectBtn = document.getElementById("disconnect-btn");
const clientIdEl = document.getElementById("client-id");
const messageInput = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");
const messagesEl = document.getElementById("messages");
const clearBtn = document.getElementById("clear-btn");
const downloadBtn = document.getElementById("download-btn");
const progressSection = document.getElementById("progress-section");
const progressBar = document.getElementById("progress-bar");
const progressText = document.getElementById("progress-text");
const refreshFilesBtn = document.getElementById("refresh-files-btn");
const filesList = document.getElementById("files-list");
const downloadUrl = document.getElementById("download-url");
const downloadFilename = document.getElementById("download-filename");
const cancelBtn = document.getElementById("cancel-btn");
const downloadSpeed = document.getElementById("download-speed");
const etaText = document.getElementById("eta-text");
let downloadStartTime = null;
let lastProgressTime = null;
let lastDownloadedBytes = 0;

function formatSpeed(bytesPerSecond) {
    const units = ["B/s", "KB/s", "MB/s", "GB/s"];
    let size = bytesPerSecond;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
}

function formatTime(seconds) {
    if (seconds < 60) {
        return `${Math.round(seconds)}s`;
    } else if (seconds < 3600) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.round(seconds % 60);
        return `${mins}m ${secs}s`;
    } else {
        const hours = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        return `${hours}h ${mins}m`;
    }
}

function updateStatus(status, color) {
    statusEl.textContent = status;
    statusEl.className = `px-3 py-1 rounded-full text-sm font-medium ${color}`;
}

function addMessage(type, content, timestamp = new Date()) {
    const messageDiv = document.createElement("div");
    messageDiv.className = `p-2 rounded text-sm ${type === "sent"
        ? "bg-blue-100 border-l-4 border-blue-500"
        : type === "received"
            ? "bg-green-100 border-l-4 border-green-500"
            : type === "system"
                ? "bg-yellow-100 border-l-4 border-yellow-500"
                : "bg-gray-100 border-l-4 border-gray-500"
        }`;

    messageDiv.innerHTML = `
          <div class="font-semibold ${type === "sent"
            ? "text-blue-800"
            : type === "received"
                ? "text-green-800"
                : type === "system"
                    ? "text-yellow-800"
                    : "text-gray-800"
        }">${type.toUpperCase()}</div>
          <div class="mt-1">${content}</div>
          <div class="text-xs text-gray-500 mt-1">${timestamp.toLocaleTimeString()}</div>
`;

    // Clear "no messages" placeholder
    if (
        messagesEl.children.length === 1 &&
        messagesEl.children[0].textContent.includes("No messages")
    ) {
        messagesEl.innerHTML = "";
    }

    messagesEl.appendChild(messageDiv);
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

function connect() {
    try {
        const wsProtocol = location.protocol === "https:" ? "wss" : "ws";
        const wsHost = location.host;
        console.log({ wsProtocol, wsHost, protocol: location.protocol });

        ws = new WebSocket(`${wsProtocol}://${wsHost}/ws`);

        ws.onopen = function (event) {
            updateStatus("Connected", "bg-green-100 text-green-800");
            connectBtn.disabled = true;
            disconnectBtn.disabled = false;
            sendBtn.disabled = false;
            addMessage("system", "Connected to WebSocket server");
            loadFiles();
        };

        ws.onmessage = function (event) {
            try {
                const data = JSON.parse(event.data);

                if (data.type === "download_info") {
                    downloadFilename.textContent = `Downloading: ${data.filename}`;
                    downloadStartTime = Date.now();
                    lastProgressTime = downloadStartTime;
                    lastDownloadedBytes = 0;
                } else if (data.type === "download_progress") {
                    const now = Date.now();
                    const progress = data.progress;
                    const downloadedBytes = data.downloadedBytes || 0;
                    const totalBytes = data.totalBytes || 0;

                    progressBar.style.width = `${progress}%`;
                    if (totalBytes > 0) {
                        progressText.textContent = `${progress}% (${formatFileSize(
                            downloadedBytes
                        )} / ${formatFileSize(totalBytes)})`;
                    } else {
                        progressText.textContent = `${progress}% (${formatFileSize(
                            downloadedBytes
                        )})`;
                    }

                    if (downloadStartTime && totalBytes > 0) {
                        const elapsedSeconds = (now - downloadStartTime) / 1000;
                        const speed = downloadedBytes / elapsedSeconds;

                        if (speed > 0) {
                            const remainingBytes = totalBytes - downloadedBytes;
                            const etaSeconds = remainingBytes / speed;

                            downloadSpeed.textContent = `${formatSpeed(speed)}`;
                            etaText.textContent =
                                etaSeconds < 3600
                                    ? formatTime(etaSeconds)
                                    : "Calculating...";
                        }
                    }
                } else if (data.type === "download_complete") {
                    progressSection.classList.add("hidden");
                    // progressBar.style.width = `${0}%`;
                    // progressText.textContent = `${0}%`;
                    downloadBtn.disabled = false;
                    addMessage("system", "Download completed! 🎉");
                    loadFiles();
                } else if (data.type === "download_cancelled") {
                    progressSection.classList.add("hidden");
                    downloadBtn.disabled = false;
                    addMessage("system", "Download cancelled");
                } else if (data.type === "download_error") {
                    progressSection.classList.add("hidden");
                    downloadBtn.disabled = false;
                    addMessage("error", `Download failed: ${data.message}`);
                } else if (data.event && data.id) {
                    clientId = data.id;
                    clientIdEl.textContent = `Client ID: ${clientId}`;
                    addMessage("system", `${data.event} (ID: ${clientId})`);
                } else if (data.type === "message") {
                    addMessage("received", data.message);
                }
            } catch (e) {
                addMessage("received", event.data);
            }
        };

        ws.onclose = function (event) {
            updateStatus("Disconnected", "bg-red-100 text-red-800");
            connectBtn.disabled = false;
            disconnectBtn.disabled = true;
            sendBtn.disabled = true;
            clientIdEl.textContent = "";
            addMessage("system", "Disconnected from server");
            ws = null;
        };

        ws.onerror = function (error) {
            addMessage(
                "error",
                `WebSocket error: ${error.message || "Connection failed"}`
            );
            updateStatus("Error", "bg-red-100 text-red-800");
        };
    } catch (error) {
        addMessage("error", `Failed to connect: ${error.message}`);
    }
}

function disconnect() {
    if (ws) {
        ws.close();
    }
}

function sendMessage() {
    const message = messageInput.value.trim();
    if (message && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "message", message }));
        addMessage("sent", message);
        messageInput.value = "";
    }
}

function clearMessages() {
    messagesEl.innerHTML =
        '<div class="text-gray-500 text-sm">No messages yet...</div>';
}

function isValidUrl(string) {
    try {
        const url = new URL(string);
        return url.protocol === "http:" || url.protocol === "https:";
    } catch {
        return false;
    }
}

async function startDownload() {
    const url = downloadUrl.value.trim();

    if (!url) {
        addMessage("error", "Please enter a URL");
        return;
    }
    downloadUrl.value = "";

    if (!isValidUrl(url)) {
        addMessage("error", "Please enter a valid HTTP/HTTPS URL");
        return;
    }

    try {
        const response = await fetch("/download", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url }),
        });

        const data = await response.json();

        if (response.ok) {
            const sizeMB = data.size / (1024 * 1024);
            if (sizeMB > 100) {
                // Warn for files > 100MB
                const proceed = confirm(
                    `Large file detected (${formatFileSize(
                        data.size
                    )}). Continue download?`
                );
                if (!proceed) return;
            }
            addMessage(
                "system",
                `Starting download: ${data.filename} (${formatFileSize(
                    data.size
                )})`
            );

            downloadFilename.textContent = `Downloading: ${data.filename}`;
            downloadSpeed.textContent = "";
            etaText.textContent = "";
            progressSection.classList.remove("hidden");
            downloadBtn.disabled = true;

            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "start_download", url }));
            }
        } else {
            addMessage("error", `Download failed: ${data.error}`);
        }
    } catch (error) {
        addMessage("error", `Download failed: ${error.message}`);
    }
}

function formatFileSize(bytes) {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

async function loadFiles() {
    try {
        const response = await fetch("/getfiles");
        const data = await response.json();
        displayFiles(data.files);
    } catch (error) {
        filesList.innerHTML =
            '<div class="text-red-500 text-sm">Error loading files</div>';
    }
}

function displayFiles(files) {
    if (files.length === 0) {
        filesList.innerHTML =
            '<div class="text-gray-500 text-sm">No files found</div>';
        return;
    }

    filesList.innerHTML = files
        .map(
            (file) => `
    <div class="flex items-center justify-between p-3 border border-gray-200 rounded hover:bg-gray-50">
      <div class="flex-1">
        <div class="font-medium">${file.name}</div>
        <div class="text-sm text-gray-500">${formatFileSize(file.size)}</div>
      </div>
      <div class="space-x-2">
        <button data-filename="${file.name}" data-action="download"
                class="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded text-sm transition-colors">
          Download
        </button>
        <button data-filename="${file.name}" data-action="delete"
                class="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded text-sm transition-colors">
          Delete
        </button>
      </div>
    </div>
  `
        )
        .join("");

    const fileButtons = filesList.querySelectorAll('button[data-action]');
    fileButtons.forEach(button => {
        button.addEventListener('click', function () {
            const filename = this.getAttribute('data-filename');
            const action = this.getAttribute('data-action');

            if (action === 'download') {
                downloadFile(filename);
            } else if (action === 'delete') {
                deleteFile(filename);
            }
        });
    });
}

function downloadFile(filename) {
    window.open(`/file/${encodeURIComponent(filename)}`, "_blank");
}

async function deleteFile(filename) {
    if (!confirm(`Delete ${filename}?`)) return;

    try {
        const response = await fetch(`/file/${filename}`, {
            method: "DELETE",
        });
        if (response.ok) {
            addMessage("system", `File ${filename} deleted`);
            loadFiles(); // Refresh list
        }
    } catch (error) {
        addMessage("error", `Failed to delete ${filename}`);
    }
}

function cancelDownload() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "cancel_download" }));
    }

    // Reset UI immediately
    progressSection.classList.add("hidden");
    downloadBtn.disabled = false;
    addMessage("system", "Download cancelled by user");
}

// Event listeners
connectBtn.addEventListener("click", connect);
disconnectBtn.addEventListener("click", disconnect);
sendBtn.addEventListener("click", sendMessage);
clearBtn.addEventListener("click", clearMessages);
downloadBtn.addEventListener("click", startDownload);
refreshFilesBtn.addEventListener("click", loadFiles);
cancelBtn.addEventListener("click", cancelDownload);

messageInput.addEventListener("keypress", function (e) {
    if (e.key === "Enter") {
        sendMessage();
    }
});

// Auto-connect on page load
window.addEventListener("load", function () {
    setTimeout(connect, 500);
});
