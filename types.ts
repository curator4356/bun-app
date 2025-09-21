export type ListFiles = {
  name: string;
  size: number;
  modified: Date;
};

export type RequstDownload = {
  url: string;
};

export interface WebSocketData {
  id: string;
  downloadController?: AbortController;
}
