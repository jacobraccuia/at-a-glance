// Single source of truth for product/assistant display names on the web client.
export const branding = {
  appName: import.meta.env.VITE_APP_NAME ?? "Taskr",
  assistantName: import.meta.env.VITE_ASSISTANT_NAME ?? "Assistant",
};
