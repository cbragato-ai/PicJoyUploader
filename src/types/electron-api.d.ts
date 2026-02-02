export interface ElectronAPI {
  saveConfig(config: any): Promise<{ success: boolean; error?: string }>;
  loadConfig(): Promise<{ success: boolean; data?: any; error?: string }>;
  configExists(): Promise<{ exists: boolean }>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
